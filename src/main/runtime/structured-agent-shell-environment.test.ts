import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createStructuredAgentEnvironmentResolvers,
  structuredAgentBaseEnvironment
} from './structured-agent-shell-environment'

let inheritedEnvironment: NodeJS.ProcessEnv
beforeEach(() => {
  inheritedEnvironment = process.env
  process.env = { PATH: '/synthetic/inherited/bin', HOME: '/synthetic/inherited/home' }
})
afterEach(() => {
  vi.unstubAllEnvs()
  process.env = inheritedEnvironment
})

const INHERIT_ALL = { inheritAll: true, names: [] }

const shellEnv = {
  PATH: '/shell/bin',
  LANG: 'en_US.UTF-8',
  SSH_AUTH_SOCK: '/tmp/agent.sock',
  CODEX_LB_API_KEY: 'lb-key',
  ANTHROPIC_API_KEY: 'shell-key',
  CLAUDE_CONFIG_DIR: '/shell/claude',
  UNSET: undefined
}

const processEnv = { PATH: '/orca/bin', HOME: '/home/me', ORCA_USER_DATA_PATH: '/orca' }

describe('structuredAgentBaseEnvironment', () => {
  it('is the whole shell snapshot, and nothing else, when inheriting all', () => {
    expect(
      structuredAgentBaseEnvironment({
        shellEnv,
        policy: INHERIT_ALL,
        processEnv,
        platform: 'darwin'
      })
    ).toEqual({
      PATH: '/shell/bin',
      LANG: 'en_US.UTF-8',
      SSH_AUTH_SOCK: '/tmp/agent.sock',
      CODEX_LB_API_KEY: 'lb-key',
      ANTHROPIC_API_KEY: 'shell-key',
      CLAUDE_CONFIG_DIR: '/shell/claude'
    })
  })

  it('passes only the baseline and listed shell names over Orca env when off', () => {
    expect(
      structuredAgentBaseEnvironment({
        shellEnv,
        policy: { inheritAll: false, names: ['CODEX_LB_API_KEY'] },
        processEnv,
        platform: 'darwin'
      })
    ).toEqual({
      PATH: '/shell/bin',
      HOME: '/home/me',
      ORCA_USER_DATA_PATH: '/orca',
      LANG: 'en_US.UTF-8',
      SSH_AUTH_SOCK: '/tmp/agent.sock',
      CODEX_LB_API_KEY: 'lb-key'
    })
  })

  it('matches names case-insensitively on Windows without duplicating Path', () => {
    expect(
      structuredAgentBaseEnvironment({
        shellEnv: { PATH: 'C:\\shell', codex_lb_api_key: 'lb-key' },
        policy: { inheritAll: false, names: ['CODEX_LB_API_KEY'] },
        processEnv: { Path: 'C:\\orca', USERPROFILE: 'C:\\Users\\me' },
        platform: 'win32'
      })
    ).toEqual({ PATH: 'C:\\shell', USERPROFILE: 'C:\\Users\\me', codex_lb_api_key: 'lb-key' })
  })
})

describe('createStructuredAgentEnvironmentResolvers', () => {
  it('gives Codex and Claude the same base, with overlays on Codex only', async () => {
    const resolvers = createStructuredAgentEnvironmentResolvers({
      resolveEnvironment: async () => ({ PATH: '/shell/bin', SHELL_ONLY: '1' }),
      resolveShellEnvironmentPolicy: () => INHERIT_ALL,
      resolveCodexOverrides: () => ({ CODEX_PROFILE: 'p' })
    })
    expect(await resolvers.resolveClaudeInheritedEnv()).toEqual({
      PATH: '/shell/bin',
      SHELL_ONLY: '1'
    })
    expect(await resolvers.resolveCodexEnvironment()).toEqual({
      PATH: '/shell/bin',
      SHELL_ONLY: '1',
      CODEX_PROFILE: 'p'
    })
  })
})

describe('synchronous completed environment', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('shares a copied shell snapshot and rereads policy, overlays and process env', async () => {
    const shell = { PATH: '/shell/bin', SHELL_SETTING: 'shell', UNSET: undefined }
    let inheritAll = true
    let overlay = { SETTING: 'one' }
    const resolvers = createStructuredAgentEnvironmentResolvers({
      resolveEnvironment: async () => shell,
      resolveShellEnvironmentPolicy: () => ({ inheritAll, names: ['SHELL_SETTING'] }),
      resolveLaunchEnvOverlay: () => overlay,
      readLaunchEnvOverlay: () => overlay,
      resolveCodexOverrides: () => ({ OVERRIDE: 'value' })
    })
    expect(resolvers.readCurrentCodexEnvironment()).toBeNull()
    const asyncEnv = await resolvers.resolveCodexEnvironment()
    expect(resolvers.readCurrentCodexEnvironment()).toEqual(asyncEnv)
    shell.SHELL_SETTING = 'mutated'
    const read = resolvers.readCurrentCodexEnvironment()!
    read.SHELL_SETTING = 'caller mutation'
    expect(await resolvers.resolveCodexEnvironment()).toEqual(asyncEnv)
    inheritAll = false
    overlay = { SETTING: 'two' }
    vi.stubEnv('ORCA_ENV_CONTINUITY_TEST', 'current')
    expect(resolvers.readCurrentCodexEnvironment()).toEqual(
      await resolvers.resolveCodexEnvironment()
    )
    expect(resolvers.readCurrentCodexEnvironment()).toMatchObject({
      SHELL_SETTING: 'shell',
      SETTING: 'two',
      ORCA_ENV_CONTINUITY_TEST: 'current'
    })
  })

  it('does not start unsupported async launch sources during observation', async () => {
    const resolveLaunchEnv = vi.fn(async () => ({ ASYNC: 'launch' }))
    const resolveLaunchEnvOverlay = vi.fn(async () => ({ ASYNC: 'overlay' }))
    for (const sources of [{ resolveLaunchEnv }, { resolveLaunchEnvOverlay }]) {
      const resolvers = createStructuredAgentEnvironmentResolvers({
        resolveEnvironment: async () => ({}),
        ...sources
      })
      await resolvers.resolveClaudeInheritedEnv()
      expect(resolvers.readCurrentCodexEnvironment()).toBeNull()
    }
    expect(resolveLaunchEnv).not.toHaveBeenCalled()
    expect(resolveLaunchEnvOverlay).not.toHaveBeenCalled()
  })

  it('keeps rejected snapshots unknown without unhandled rejection', async () => {
    const resolvers = createStructuredAgentEnvironmentResolvers({
      resolveEnvironment: async () => {
        throw new Error('private shell failure')
      }
    })
    expect(resolvers.readCurrentCodexEnvironment()).toBeNull()
    await expect(resolvers.resolveCodexEnvironment()).rejects.toThrow('private shell failure')
    expect(resolvers.readCurrentCodexEnvironment()).toBeNull()
  })

  it.each([
    () => {
      throw new Error('private source failure')
    },
    () => ({ BAD: 42 }),
    () => Promise.reject(new Error('private rejected source')),
    () => null
  ])('refuses malformed synchronous overlay companions', async (readLaunchEnvOverlay) => {
    const resolvers = createStructuredAgentEnvironmentResolvers({
      resolveEnvironment: async () => ({}),
      resolveLaunchEnvOverlay: () => ({}),
      readLaunchEnvOverlay
    })
    await resolvers.resolveClaudeInheritedEnv()
    expect(resolvers.readCurrentCodexEnvironment()).toBeNull()
    await Promise.resolve()
  })
})

describe('synchronous policy observation', () => {
  async function fixture(resolvePolicy: () => unknown) {
    const sources = {
      resolveEnvironment: async () => ({ PATH: '/synthetic/bin', SELECTED: 'shell' })
    }
    Object.defineProperty(sources, 'resolveShellEnvironmentPolicy', { value: resolvePolicy })
    const resolvers = createStructuredAgentEnvironmentResolvers(sources)
    await Promise.resolve()
    return resolvers
  }

  it.each([
    () => null,
    () => ({ inheritAll: 'bad', names: [] }),
    () => ({ inheritAll: true, names: null }),
    () => ({ inheritAll: true, names: ['not valid'] }),
    () => ({ inheritAll: false, names: [42] }),
    () => {
      throw new Error('private policy failure')
    },
    () => ({
      get inheritAll() {
        throw new Error('private getter failure')
      },
      names: []
    })
  ])('refuses malformed or throwing policy sources', async (resolvePolicy) => {
    const resolvers = await fixture(resolvePolicy)
    expect(resolvers.readCurrentCodexEnvironment()).toBeNull()
  })

  it('consumes rejected asynchronous policy observations privately', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const resolvers = await fixture(() => Promise.reject(new Error('private rejected policy')))
      expect(resolvers.readCurrentCodexEnvironment()).toBeNull()
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('copies lazy policy fields once before composing the environment', async () => {
    const inheritAll = vi.fn(() => false)
    const names = vi.fn(() => ['SELECTED'])
    const resolvers = await fixture(() => ({
      get inheritAll() {
        return inheritAll()
      },
      get names() {
        return names()
      }
    }))
    expect(resolvers.readCurrentCodexEnvironment()).toEqual({
      PATH: '/synthetic/bin',
      HOME: '/synthetic/inherited/home',
      SELECTED: 'shell'
    })
    expect(inheritAll).toHaveBeenCalledTimes(1)
    expect(names).toHaveBeenCalledTimes(1)
  })
})
