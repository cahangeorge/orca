import {
  beginCodexModelCatalogProbeContext,
  type CodexModelCatalogProbeContextReader
} from './codex-model-catalog-probe-context'
import { resolveCodexCommand, withCliRuntimeOnPath } from '../codex-cli/command'
import { getSpawnArgsForWindows } from '../win32-utils'
import { CODEX_SHORT_LIVED_PROBE_APP_SERVER_ARGS } from '../codex-cli/codex-read-only-app-server-args'
import { runCodexAppServerSession } from './codex-app-server-session'
import { fetchCodexModelCatalogListing } from './codex-structured-model-catalog'
import {
  resolveCodexStructuredInvocation,
  type CodexStructuredLaunchResolverDeps
} from './codex-structured-launch-resolution'
import type {
  AgentModelCatalogProbe,
  AgentModelCatalogSuccess
} from '../native-chat/agent-model-catalog/agent-model-catalog-store'

// Why 15s: the whole probe session is SIGKILLed at the deadline, and a cold
// `model/list` may pay one network /models fetch behind provider auth.
const CODEX_MODEL_CATALOG_PROBE_TIMEOUT_MS = 15_000

export type CodexModelCatalogProbeDeps = Pick<
  CodexStructuredLaunchResolverDeps,
  'resolveCommand' | 'resolveEnvironment'
> & {
  /** Test seam; production runs the shared short-lived app-server session. */
  runSession?: typeof runCodexAppServerSession
  readCurrentContext?: CodexModelCatalogProbeContextReader
  readCurrentEnvironment?: () => unknown
}

function definedEnv(env: NodeJS.ProcessEnv | undefined): Record<string, string> {
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(env ?? {})) {
    if (value !== undefined) {
      next[key] = value
    }
  }
  return next
}

/**
 * Lists models without a live session: one short-lived read-only app-server
 * under the given account home, spawned through the SAME invocation resolver
 * a structured session launch uses — a probe that resolved a different binary
 * or env could list models the user's sessions cannot see, under their key.
 */
export function createCodexModelCatalogProbe(
  deps: CodexModelCatalogProbeDeps
): AgentModelCatalogProbe {
  return async (accountHomePath: string): Promise<AgentModelCatalogSuccess> => {
    const { command, environment } = await resolveCodexStructuredInvocation(deps)
    const { spawnCmd, spawnArgs } = getSpawnArgsForWindows(command, [
      ...CODEX_SHORT_LIVED_PROBE_APP_SERVER_ARGS
    ])
    const run = deps.runSession ?? runCodexAppServerSession
    const invocation = {
      command: spawnCmd,
      args: spawnArgs,
      cliPath: command,
      env: definedEnv(
        withCliRuntimeOnPath(command, {
          ...process.env,
          ...definedEnv(environment),
          CODEX_HOME: accountHomePath
        })
      ),
      timeoutMs: CODEX_MODEL_CATALOG_PROBE_TIMEOUT_MS
    }
    const completeContext = beginCodexModelCatalogProbeContext(
      invocation,
      accountHomePath,
      guardedContextReader(deps, command, invocation.env, accountHomePath)
    )
    const listing = await run(invocation, (rpc) =>
      fetchCodexModelCatalogListing({ connection: rpc })
    )
    if (listing.models.length === 0) {
      throw new Error('codex app-server listed no models')
    }
    const success: AgentModelCatalogSuccess = {
      models: listing.models,
      fastModeTierByModel: listing.fastModeTierByModel,
      origin: 'probe'
    }
    completeContext(success)
    return success
  }
}

function guardedContextReader(
  deps: CodexModelCatalogProbeDeps,
  pinnedCommand: string,
  pinnedEnvironment: Record<string, string>,
  accountHomePath: string
): CodexModelCatalogProbeContextReader | undefined {
  const readEnvironment = deps.readCurrentEnvironment
  const readContext = deps.readCurrentContext
  // Legacy trusted readers already promise launch/account proof; runtime wiring always guards.
  if (!readEnvironment || !readContext) {
    return readContext
  }
  let current = true
  const environmentMatches = (): boolean => {
    const value = readEnvironment()
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return false
    }
    if ('then' in value) {
      void Promise.resolve(value).catch(() => {})
      return false
    }
    const environment: NodeJS.ProcessEnv = {}
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined && typeof entry !== 'string') {
        return false
      }
      environment[key] = entry
    }
    const homePath = environment.HOME ?? environment.USERPROFILE
    const command = (deps.resolveCommand ?? resolveCodexCommand)({
      pathEnv: environment.PATH ?? environment.Path ?? null,
      ...(homePath ? { homePath } : {})
    })
    const inherited = { ...process.env, ...definedEnv(environment), CODEX_HOME: accountHomePath }
    if (!comparableEnvironment(definedEnv(inherited))) {
      return false
    }
    const effective = comparableEnvironment(definedEnv(withCliRuntimeOnPath(command, inherited)))
    const pinned = comparableEnvironment(pinnedEnvironment)
    return (
      command === pinnedCommand &&
      effective !== null &&
      pinned !== null &&
      effective.size === pinned.size &&
      [...effective].every(([key, entry]) => pinned.get(key) === entry)
    )
  }
  return (context) => {
    try {
      if (!current || !environmentMatches()) {
        current = false
        return null
      }
      const value = readContext(context)
      let observation: { status: 'known'; key: string } | null = null
      if (typeof value === 'object' && value !== null) {
        if ('then' in value) {
          void Promise.resolve(value).catch(() => {})
        } else {
          const status = 'status' in value ? value.status : undefined
          const key = 'key' in value ? value.key : undefined
          if (status === 'known' && typeof key === 'string') {
            observation = { status, key }
          }
        }
      }
      // Account callbacks and getters can synchronously change launch inputs.
      if (!environmentMatches()) {
        current = false
        return null
      }
      return observation
    } catch {
      current = false
      return null
    }
  }
}

function comparableEnvironment(environment: Record<string, string>): Map<string, string> | null {
  const entries = new Map<string, string>()
  for (const [name, value] of Object.entries(environment)) {
    const key = process.platform === 'win32' ? name.toUpperCase() : name
    if (entries.has(key) && entries.get(key) !== value) {
      return null
    }
    entries.set(key, value)
  }
  return entries
}
