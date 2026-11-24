import {
  createSimulatedDecisionShadowProvider,
  type DecisionShadowProvider,
  type DecisionShadowProviderInput
} from './decision-shadow-provider'
const REVISION = 'beeeb640f3333aec4ef78ed3b7bd0605f973a590'
const MAX_RESPONSE_BYTES = 65536
const categories: Record<string, string> = {
  docs: 'Documentation or simple configuration work',
  implementation: 'Bounded code implementation with tests',
  debugging: 'Diagnose and fix a defect',
  research: 'Research and verify sources',
  review: 'Review code, architecture or security',
  needs_context: 'Insufficient or ambiguous context; abstain'
}
function endpointFor(value: string): URL {
  try {
    const url = new URL(value)
    if (
      !/^http:\/\/(?:127\.0\.0\.1|\[::1\]):[0-9]+\/?$/.test(value) ||
      url.protocol !== 'http:' ||
      !['127.0.0.1', '[::1]'].includes(url.hostname) ||
      !url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    ) {
      throw new Error('Invalid local decision service response')
    }
    return url
  } catch {
    throw new Error('Invalid local decision service endpoint')
  }
}
function laneDescription(choice: string): string {
  if (choice === 'needs_context') {
    return 'Insufficient context or no appropriate available execution lane; abstain'
  }
  const parsed: unknown = JSON.parse(choice)
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[0] !== 'string' ||
    typeof parsed[1] !== 'string'
  ) {
    throw new Error('Invalid lane choice')
  }
  const names: Record<string, string> = {
    'gpt-6-luna': 'Luna: focused discovery or documentation',
    'gpt-6.1-sol': 'Sol: bounded implementation, diagnosis and review',
    'gpt-6-astra': 'Astra: exceptional difficult work'
  }
  const name = names[parsed[0]]
  if (!name) {
    throw new Error('Invalid lane choice')
  }
  return `${name}; ${parsed[1]} reasoning effort. Available in this session catalog.`
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
async function readJson(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) {
    void response.body?.cancel().catch(() => {})
    throw new Error('Invalid local decision service response')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let size = 0
  let text = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) {
        break
      }
      size += chunk.value.byteLength
      if (size > MAX_RESPONSE_BYTES) {
        throw new Error('Invalid local decision service response')
      }
      text += decoder.decode(chunk.value, { stream: true })
    }
    text += decoder.decode()
    return JSON.parse(text)
  } catch {
    throw new Error('Invalid local decision service response')
  } finally {
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
export function createOpenDeciderShadowProvider(
  options: { endpoint?: string; revision?: string; fetch?: typeof fetch } = {}
): DecisionShadowProvider {
  if (options.revision !== undefined && !/^[a-f0-9]{40}$/i.test(options.revision)) {
    throw new Error('Invalid configured model revision')
  }
  const endpoint = endpointFor(options.endpoint ?? 'http://127.0.0.1:18083')
  const fetcher = options.fetch ?? fetch
  const request = async (path: string, signal: AbortSignal, body?: unknown) =>
    readJson(
      await fetcher(new URL(path, endpoint), {
        method: body === undefined ? 'GET' : 'POST',
        redirect: 'error',
        signal,
        ...(body === undefined
          ? {}
          : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      })
    )
  return {
    id: 'opendecider-nano',
    modelRevision: `configured:${options.revision ?? REVISION}`,
    async evaluate(input: DecisionShadowProviderInput, signal: AbortSignal): Promise<unknown> {
      if (
        signal.aborted ||
        input.text.length + (input.context?.length ?? 0) > 4096 ||
        input.taskCategoryChoices.length > 8 ||
        input.executionLaneChoices.length > 8
      ) {
        throw new Error('Invalid local decision input')
      }
      const ready = await request('/ready', signal)
      if (!record(ready) || ready.ready !== true) {
        throw new Error('Local decision service unavailable')
      }
      const health = await request('/health', signal)
      if (
        !record(health) ||
        health.version !== '0.6.0' ||
        typeof health.device !== 'string' ||
        !/^(?:cpu|cuda(?::\d+)?)$/.test(health.device)
      ) {
        throw new Error('Local decision service incompatible')
      }
      const response = await request('/v1/systemone', signal, {
        state: input.context ? `${input.text}\nContext: ${input.context}` : input.text,
        questions: {
          task_category: {
            type: 'choice',
            instructions: 'Classify this autonomous task. Choose needs_context when ambiguous.',
            criteria: Object.fromEntries(
              input.taskCategoryChoices.map((choice) => [
                choice,
                categories[choice] ?? 'Insufficient context'
              ])
            )
          },
          execution_lane: {
            type: 'choice',
            instructions:
              'Recommend one available model/reasoning pair. This is observation only; no routing occurs.',
            criteria: Object.fromEntries(
              input.executionLaneChoices.map((choice) => [choice, laneDescription(choice)])
            )
          }
        }
      })
      if (
        !record(response) ||
        typeof response.model !== 'string' ||
        !/nano/i.test(response.model) ||
        !record(response.answers)
      ) {
        throw new Error('Invalid local decision service response')
      }
      return {
        task_category: response.answers.task_category,
        execution_lane: response.answers.execution_lane
      }
    }
  }
}
export function createDecisionShadowProviderForEnvironment(
  env: NodeJS.ProcessEnv = process.env
): DecisionShadowProvider {
  if (env.ORCA_DECISION_SHADOW_PROVIDER === 'simulated-fixture') {
    return createSimulatedDecisionShadowProvider()
  }
  try {
    return createOpenDeciderShadowProvider({
      endpoint: env.ORCA_DECISION_SHADOW_ENDPOINT,
      revision: env.ORCA_DECISION_SHADOW_REVISION
    })
  } catch {
    return {
      id: 'opendecider-nano',
      modelRevision: 'configured:unavailable',
      evaluate: async () => {
        throw new Error('Local decision service configuration unavailable')
      }
    }
  }
}
