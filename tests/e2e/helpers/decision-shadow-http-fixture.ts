import { createServer, type ServerResponse } from 'node:http'
import { z } from 'zod'
import { test as base } from './decision-shadow-native-chat-fixture'

const requestSchema = z.object({
  state: z.string(),
  questions: z.object({
    task_category: z.object({ criteria: z.record(z.string(), z.string()) }),
    execution_lane: z.object({ criteria: z.record(z.string(), z.string()) })
  })
})
type Scenario = 'gated' | 'unavailable' | 'abstain'
type Gate = { release: () => void; released: boolean; receivedAtNs: string }

// Only exercises the Nano HTTP protocol. No model is loaded or evaluated.
export async function createControlledShadowHttp() {
  let scenario: Scenario = 'gated'
  const gates: Gate[] = []
  const reply = (response: ServerResponse, body: unknown, status = 200) => {
    response.writeHead(status, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(body))
  }
  const server = createServer(async (request, response) => {
    if (request.url === '/ready') {
      reply(response, { ready: true })
      return
    }
    if (request.url === '/health') {
      reply(response, { version: '0.6.0', device: 'cpu' })
      return
    }
    if (request.method !== 'POST' || request.url !== '/v1/systemone') {
      reply(response, {}, 404)
      return
    }
    try {
      let body = ''
      for await (const chunk of request) {
        body += String(chunk)
        if (body.length > 65536) {
          reply(response, {}, 413)
          return
        }
      }
      const input = requestSchema.parse(JSON.parse(body))
      if (scenario === 'unavailable') {
        reply(response, { error: 'controlled fixture failure' }, 503)
        return
      }
      const abstain = scenario === 'abstain'
      const answer = (criteria: Record<string, string>, preferred: string) => {
        const choice = abstain ? 'needs_context' : preferred
        if (!(choice in criteria)) {
          throw new Error('Missing expected fixture choice')
        }
        return {
          choice,
          confidence: 1,
          probabilities: Object.fromEntries(
            Object.keys(criteria).map((key) => [key, Number(key === choice)])
          )
        }
      }
      const lane = Object.keys(input.questions.execution_lane.criteria).find(
        (key) => key !== 'needs_context'
      )
      if (!lane) {
        throw new Error('Missing supported fixture lane')
      }
      const result = {
        model: 'OpenDecider-Nano-controlled-http-fixture',
        answers: {
          task_category: answer(input.questions.task_category.criteria, 'implementation'),
          execution_lane: answer(input.questions.execution_lane.criteria, lane)
        }
      }
      if (abstain) {
        reply(response, result)
        return
      }
      const gate: Gate = {
        released: false,
        receivedAtNs: process.hrtime.bigint().toString(),
        release() {
          if (!gate.released) {
            gate.released = true
            reply(response, result)
          }
        }
      }
      gates.push(gate)
    } catch {
      if (!response.headersSent) {
        reply(response, {}, 400)
      } else {
        response.destroy()
      }
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Missing owned fixture port')
  }
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    gates,
    setScenario(next: Scenario) {
      scenario = next
    },
    async close() {
      for (const gate of gates) {
        gate.release()
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      })
    }
  }
}

export const test = base.extend<{
  controlledHttp: Awaited<ReturnType<typeof createControlledShadowHttp>>
}>({
  controlledHttp: async ({ registerPostElectronShutdownCleanup }, provideFixture) => {
    const fixture = await createControlledShadowHttp()
    registerPostElectronShutdownCleanup(() => fixture.close())
    await provideFixture(fixture)
  },
  shadowEndpoint: async ({ controlledHttp }, provideFixture) => {
    await provideFixture(controlledHttp.endpoint)
  }
})
