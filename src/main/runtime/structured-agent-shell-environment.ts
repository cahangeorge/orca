import { resolveLoginShellEnvironment } from '../startup/login-shell-environment'
import {
  isNativeChatShellEnvironmentName,
  nativeChatShellEnvironmentPolicy,
  type NativeChatShellEnvironmentPolicy
} from '../../shared/native-chat-shell-environment'

// Why: with the whole shell off, the child must still find its CLI and keep locale and agent socket.
const BASELINE_SHELL_VARIABLES = ['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'SSH_AUTH_SOCK']

function definedEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const defined: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      defined[key] = value
    }
  }
  return defined
}

/** Overlays shell variables on Orca's env; win32 names are case-insensitive, so drop the base spelling. */
function overlayShellVariables(
  base: Record<string, string>,
  shellVariables: Record<string, string>,
  platform: NodeJS.Platform
): Record<string, string> {
  const merged = { ...base }
  if (platform === 'win32') {
    const overlaid = new Set(Object.keys(shellVariables).map((key) => key.toUpperCase()))
    for (const key of Object.keys(merged)) {
      if (overlaid.has(key.toUpperCase())) {
        delete merged[key]
      }
    }
  }
  return { ...merged, ...shellVariables }
}

function pickShellVariables(
  shellEnv: NodeJS.ProcessEnv,
  names: readonly string[],
  platform: NodeJS.Platform
): Record<string, string> {
  const normalize = (key: string): string => (platform === 'win32' ? key.toUpperCase() : key)
  const allowed = new Set([...BASELINE_SHELL_VARIABLES, ...names].map(normalize))
  const picked: Record<string, string> = {}
  for (const [key, value] of Object.entries(definedEnv(shellEnv))) {
    if (allowed.has(normalize(key))) {
      picked[key] = value
    }
  }
  return picked
}

/**
 * The env every structured chat child starts from, before its provider pins an account.
 * Inheriting everything is the login-shell snapshot as-is; otherwise Orca's own env plus
 * the baseline and listed shell variables.
 */
export function structuredAgentBaseEnvironment(input: {
  shellEnv: NodeJS.ProcessEnv
  policy: NativeChatShellEnvironmentPolicy
  processEnv?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}): Record<string, string> {
  if (input.policy.inheritAll) {
    return definedEnv(input.shellEnv)
  }
  const platform = input.platform ?? process.platform
  return overlayShellVariables(
    definedEnv(input.processEnv ?? process.env),
    pickShellVariables(input.shellEnv, input.policy.names, platform),
    platform
  )
}

export type StructuredAgentEnvironmentSources = {
  resolveEnvironment?: () => Promise<NodeJS.ProcessEnv>
  resolveShellEnvironmentPolicy?: () => NativeChatShellEnvironmentPolicy
  resolveLaunchEnv?: () => Promise<NodeJS.ProcessEnv>
  resolveLaunchEnvOverlay?: () => Promise<Record<string, string>> | Record<string, string>
  readLaunchEnvOverlay?: () => unknown
  resolveCodexOverrides?: () => NodeJS.ProcessEnv
}

/**
 * Both providers' child envs over one login-shell snapshot, taken once at install.
 * The policy and overlays are re-read per acquisition, so a settings change reaches
 * the next chat without a restart.
 */
export function createStructuredAgentEnvironmentResolvers(
  sources: StructuredAgentEnvironmentSources
): {
  resolveCodexEnvironment: () => Promise<NodeJS.ProcessEnv>
  resolveClaudeInheritedEnv: () => Promise<Record<string, string>>
  readCurrentCodexEnvironment: () => NodeJS.ProcessEnv | null
} {
  let completedShellEnvironment: NodeJS.ProcessEnv | null = null
  const shellEnvironment = (sources.resolveEnvironment ?? resolveLoginShellEnvironment)().then(
    (environment) => {
      completedShellEnvironment = Object.freeze({ ...environment })
      return completedShellEnvironment
    }
  )
  // Async acquisitions still see rejection; synchronous readers never retry the source.
  void shellEnvironment.catch(() => {})
  const resolveBase = async (): Promise<Record<string, string>> =>
    structuredAgentBaseEnvironment({
      shellEnv: await shellEnvironment,
      policy: sources.resolveShellEnvironmentPolicy?.() ?? nativeChatShellEnvironmentPolicy(null)
    })
  return {
    resolveCodexEnvironment: async () => ({
      ...(await resolveBase()),
      ...(await sources.resolveLaunchEnv?.()),
      ...(await sources.resolveLaunchEnvOverlay?.()),
      ...sources.resolveCodexOverrides?.()
    }),
    resolveClaudeInheritedEnv: resolveBase,
    readCurrentCodexEnvironment: () => {
      if (!completedShellEnvironment || sources.resolveLaunchEnv) {
        return null
      }
      if (sources.resolveLaunchEnvOverlay && !sources.readLaunchEnvOverlay) {
        return null
      }
      try {
        const policy = sources.resolveShellEnvironmentPolicy
          ? readSynchronousPolicy(sources.resolveShellEnvironmentPolicy())
          : nativeChatShellEnvironmentPolicy(null)
        if (!policy) {
          return null
        }
        const base = structuredAgentBaseEnvironment({
          shellEnv: completedShellEnvironment,
          policy
        })
        const overlay = sources.readLaunchEnvOverlay
          ? readSynchronousEnvironment(sources.readLaunchEnvOverlay())
          : {}
        const overrides = sources.resolveCodexOverrides
          ? readSynchronousEnvironment(sources.resolveCodexOverrides())
          : {}
        return overlay && overrides ? { ...base, ...overlay, ...overrides } : null
      } catch {
        return null
      }
    }
  }
}

function readSynchronousEnvironment(value: unknown): NodeJS.ProcessEnv | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  if ('then' in value) {
    void Promise.resolve(value).catch(() => {})
    return null
  }
  const environment: NodeJS.ProcessEnv = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined && typeof entry !== 'string') {
      return null
    }
    environment[key] = entry
  }
  return environment
}

function readSynchronousPolicy(value: unknown): NativeChatShellEnvironmentPolicy | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  if ('then' in value) {
    void Promise.resolve(value).catch(() => {})
    return null
  }
  const inheritAll = 'inheritAll' in value ? value.inheritAll : undefined
  const candidateNames = 'names' in value ? value.names : undefined
  if (typeof inheritAll !== 'boolean' || !Array.isArray(candidateNames)) {
    return null
  }
  const names: string[] = []
  for (const name of candidateNames) {
    if (typeof name !== 'string' || !isNativeChatShellEnvironmentName(name)) {
      return null
    }
    names.push(name)
  }
  return { inheritAll, names }
}
