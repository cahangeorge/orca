import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentModelCatalogFingerprint } from '../native-chat/agent-model-catalog/agent-model-catalog-fingerprint'
import {
  createInitialSelectionCatalogEvidence,
  type InitialSelectionCatalogContext
} from '../native-chat/agent-model-catalog/agent-model-catalog-initial-selection'
import { AgentModelCatalogStore } from '../native-chat/agent-model-catalog/agent-model-catalog-store'
import { createStructuredAgentEnvironmentResolvers } from '../runtime/structured-agent-shell-environment'
import { withCliRuntimeOnPath } from '../../shared/node-cli-command-resolution'
import { createCodexModelCatalogProbe } from './codex-model-catalog-probe'
import { resolveCodexStructuredInvocation } from './codex-structured-launch-resolution'
import { runCodexAppServerSession, type CodexAppServerInvocation } from './codex-app-server-session'

let inheritedEnvironment: NodeJS.ProcessEnv
beforeEach(() => {
  inheritedEnvironment = process.env
  process.env = { PATH: '/synthetic/inherited/bin', HOME: '/synthetic/inherited/home' }
})
afterEach(() => {
  vi.unstubAllEnvs()
  process.env = inheritedEnvironment
})

const MODEL_ROW = {
  model: 'gpt-live',
  displayName: 'GPT Live',
  hidden: false,
  supportedReasoningEfforts: [{ reasoningEffort: 'high' }],
  isDefault: true
}

describe('codex model catalog probe', () => {
  it('spawns with the same resolved command and env as a structured session launch', async () => {
    // The env a user's shell/config resolves for sessions, PATH included.
    const resolveEnvironment = async (): Promise<NodeJS.ProcessEnv> => ({
      PATH: '/resolved/bin',
      HOME: '/homes/user',
      OPENAI_BASE_URL: 'https://gateway.example',
      DROPPED: undefined
    })
    const resolveCommand = vi.fn((options?: { pathEnv?: string | null; homePath?: string }) => {
      expect(options?.pathEnv).toBe('/resolved/bin')
      expect(options?.homePath).toBe('/homes/user')
      return '/resolved/bin/codex'
    })
    const invocations: CodexAppServerInvocation[] = []
    const probe = createCodexModelCatalogProbe({
      resolveEnvironment,
      resolveCommand,
      runSession: async (invocation, body) => {
        invocations.push(invocation)
        return body({
          request: async () => ({ data: [MODEL_ROW], nextCursor: null }),
          notify: () => {}
        })
      }
    })
    const success = await probe('/homes/account-a')
    expect(success.origin).toBe('probe')
    expect(success.models.map((model) => model.id)).toEqual(['gpt-live'])
    // The session launch resolves the exact same invocation for the same deps.
    const sessionInvocation = await resolveCodexStructuredInvocation({
      resolveEnvironment,
      resolveCommand
    })
    expect(invocations).toHaveLength(1)
    expect(invocations[0]!.cliPath).toBe(sessionInvocation.command)
    expect(invocations[0]!.env).toEqual(
      withCliRuntimeOnPath(sessionInvocation.command, {
        ...process.env,
        PATH: '/resolved/bin',
        HOME: '/homes/user',
        OPENAI_BASE_URL: 'https://gateway.example',
        CODEX_HOME: '/homes/account-a'
      })
    )
    // A short-lived probe must not start plugin marketplace clones that outlive its teardown.
    expect(invocations[0]!.args.join(' ')).toContain('features.plugins=false')
  })

  it('keeps the listing when config/read never answers', async () => {
    const server = String.raw`
      const readline = require('node:readline')
      readline.createInterface({ input: process.stdin }).on('line', (line) => {
        const message = JSON.parse(line)
        if (typeof message.id !== 'number' || message.method === 'config/read') return
        const result = message.method === 'model/list'
          ? { data: [${JSON.stringify(MODEL_ROW)}], nextCursor: null }
          : {}
        process.stdout.write(JSON.stringify({ id: message.id, result }) + '\n')
      })
    `
    const probe = createCodexModelCatalogProbe({
      resolveEnvironment: async () => ({ PATH: '/bin' }),
      resolveCommand: () => '/bin/codex',
      // Real transport against a fake server; a session deadline shorter than the
      // production one keeps the test fast while still outliving config/read's bound.
      runSession: (invocation, body) =>
        runCodexAppServerSession(
          {
            ...invocation,
            command: process.execPath,
            cliPath: null,
            args: ['-e', server],
            timeoutMs: 6_000
          },
          body
        )
    })
    const success = await probe('/homes/a')
    expect(success.models.map((model) => ({ id: model.id, isDefault: model.isDefault }))).toEqual([
      { id: 'gpt-live', isDefault: true }
    ])
  }, 10_000)

  it('refuses an empty listing rather than reporting it as a catalog', async () => {
    const probe = createCodexModelCatalogProbe({
      resolveEnvironment: async () => ({ PATH: '/bin' }),
      resolveCommand: () => '/bin/codex',
      runSession: async (_invocation, body) =>
        body({ request: async () => ({ data: [], nextCursor: null }), notify: () => {} })
    })
    await expect(probe('/homes/a')).rejects.toThrow(/listed no models/)
  })
})

it('connects actual probe continuity to the exact store entry', async () => {
  let key = 'launch-account-a'
  const store = new AgentModelCatalogStore()
  const probe = createCodexModelCatalogProbe({
    resolveEnvironment: async () => ({ PATH: '/bin' }),
    resolveCommand: () => '/bin/codex',
    readCurrentContext: () => ({ status: 'known', key }),
    runSession: async (_invocation, body) =>
      body({ request: async () => ({ data: [MODEL_ROW], nextCursor: null }), notify: () => {} })
  })
  const success = await probe('/homes/a')
  const entry = store.recordSuccess('account-a', 'codex', success)!
  expect(store.hasCurrentProbeContextEvidence(entry, '/homes/a')).toBe(true)
  key = 'launch-account-b'
  expect(store.hasCurrentProbeContextEvidence(entry, '/homes/a')).toBe(false)
  key = 'launch-account-a'
  expect(store.hasCurrentProbeContextEvidence(entry, '/homes/a')).toBe(false)
})

describe('runtime environment continuity at the actual probe and store', () => {
  afterEach(() => vi.unstubAllEnvs())

  async function fixture(
    options: {
      duringProbe?: () => void
      duringAccountRead?: () => void
      readLaunchEnvOverlay?: () => unknown
      accountObservation?: () => unknown
    } = {}
  ) {
    let settings = { SETTING: 'one' }
    let command = '/synthetic/codex'
    let inheritAll = true
    const resolver = createStructuredAgentEnvironmentResolvers({
      resolveEnvironment: async () => ({ PATH: '/synthetic/bin', HOME: '/synthetic/home' }),
      resolveShellEnvironmentPolicy: () => ({ inheritAll, names: [] }),
      resolveLaunchEnvOverlay: () => settings,
      readLaunchEnvOverlay: options.readLaunchEnvOverlay ?? (() => settings)
    })
    const store = new AgentModelCatalogStore()
    const probe = createCodexModelCatalogProbe({
      resolveEnvironment: resolver.resolveCodexEnvironment,
      readCurrentEnvironment: resolver.readCurrentCodexEnvironment,
      resolveCommand: () => command,
      // Explicitly synthetic account evidence; no auth files or live account calls.
      readCurrentContext: () => {
        options.duringAccountRead?.()
        return options.accountObservation?.() ?? { status: 'known', key: 'synthetic-account-a' }
      },
      runSession: async (_invocation, body) => {
        options.duringProbe?.()
        return body({
          request: async () => ({ data: [MODEL_ROW], nextCursor: null }),
          notify: () => {}
        })
      }
    })
    const success = await probe('/synthetic/account')
    const context: InitialSelectionCatalogContext = {
      ownerKey: 'synthetic-owner',
      executionHostId: 'synthetic-host',
      workspaceId: 'synthetic-workspace',
      workspacePath: '/synthetic/workspace',
      policyVersion: 'synthetic-policy',
      account: {
        agent: 'codex',
        accountHomeVariable: 'CODEX_HOME',
        accountHomePath: '/synthetic/account',
        wslDistro: null
      }
    }
    const entry = store.recordSuccess(
      agentModelCatalogFingerprint(context.account),
      'codex',
      success
    )!
    const evidence = createInitialSelectionCatalogEvidence({ store })
    return {
      evidence,
      context,
      isCurrent: () => store.hasCurrentProbeContextEvidence(entry, '/synthetic/account'),
      setSettings: () => {
        settings = { SETTING: 'two' }
      },
      setCommand: () => {
        command = '/synthetic/other-codex'
      },
      setPolicy: () => {
        inheritAll = false
      },
      entry
    }
  }

  it('accepts matching completed runtime environment then revokes changed settings', async () => {
    const state = await fixture()
    expect(state.isCurrent()).toBe(true)
    const issued = state.evidence.issue(state.context)
    expect(issued.status).toBe('ready')
    if (issued.status !== 'ready') {
      throw new Error('synthetic fixture did not issue')
    }
    expect(
      state.evidence.validateNewCreate({
        context: state.context,
        catalogRef: issued.catalogRef,
        selection: { model: 'gpt-live', effort: 'high' }
      }).status
    ).toBe('validated')
    state.setSettings()
    expect(
      state.evidence.validateNewCreate({
        context: state.context,
        catalogRef: issued.catalogRef,
        selection: { model: 'gpt-live', effort: 'high' }
      }).status
    ).toBe('refused')
    expect(state.isCurrent()).toBe(false)
  })

  it('revokes changed CLI command and shell policy', async () => {
    for (const field of ['setCommand', 'setPolicy'] as const) {
      const state = await fixture()
      expect(state.isCurrent()).toBe(true)
      state[field]()
      expect(state.isCurrent()).toBe(false)
    }
  })

  it('revokes inherited process variables absent from the resolved overlay', async () => {
    vi.stubEnv('ORCA_PROBE_INHERITED_TEST', 'before')
    const state = await fixture()
    expect(state.isCurrent()).toBe(true)
    vi.stubEnv('ORCA_PROBE_INHERITED_TEST', 'after')
    expect(state.isCurrent()).toBe(false)
  })

  it('refuses drift during probe while retaining the legacy listing', async () => {
    vi.stubEnv('ORCA_PROBE_INHERITED_TEST', 'before')
    const state = await fixture({
      duringProbe: () => vi.stubEnv('ORCA_PROBE_INHERITED_TEST', 'after')
    })
    expect(state.entry.models[0]?.id).toBe('gpt-live')
    expect(state.isCurrent()).toBe(false)
  })

  it('rechecks environment after the independent account callback', async () => {
    vi.stubEnv('ORCA_PROBE_CALLBACK_TEST', 'before')
    const state = await fixture({
      duringAccountRead: () => vi.stubEnv('ORCA_PROBE_CALLBACK_TEST', 'after')
    })
    expect(state.isCurrent()).toBe(false)
  })

  it('rechecks result getters and validation-time callback mutation', async () => {
    const getterState = await fixture({
      accountObservation: () => ({
        status: 'known',
        get key() {
          vi.stubEnv('ORCA_PROBE_GETTER_TEST', 'changed')
          return 'synthetic-account-a'
        }
      })
    })
    expect(getterState.isCurrent()).toBe(false)
    let mutate = false
    const state = await fixture({
      duringAccountRead: () => {
        if (mutate) {
          vi.stubEnv('ORCA_PROBE_VALIDATION_TEST', 'changed')
        }
      }
    })
    expect(state.isCurrent()).toBe(true)
    mutate = true
    expect(state.isCurrent()).toBe(false)
  })

  it('compares map values independently of key order and drops undefined overlay values', async () => {
    let overlay: NodeJS.ProcessEnv = {
      PATH: '/synthetic/bin',
      HOME: '/synthetic/home',
      DROPPED: undefined
    }
    const store = new AgentModelCatalogStore()
    const probe = createCodexModelCatalogProbe({
      resolveEnvironment: async () => overlay,
      readCurrentEnvironment: () => overlay,
      resolveCommand: (options) =>
        `/synthetic/${options?.homePath === '/synthetic/home' ? 'codex' : 'other'}`,
      readCurrentContext: () => ({ status: 'known', key: 'synthetic-account' }),
      runSession: async (_invocation, body) =>
        body({ request: async () => ({ data: [MODEL_ROW], nextCursor: null }), notify: () => {} })
    })
    const entry = store.recordSuccess(
      'synthetic-order',
      'codex',
      await probe('/synthetic/account')
    )!
    overlay = { HOME: '/synthetic/home', DROPPED: undefined, PATH: '/synthetic/bin' }
    expect(store.hasCurrentProbeContextEvidence(entry, '/synthetic/account')).toBe(true)
    overlay = { ...overlay, PATH: '/synthetic/changed-bin' }
    expect(store.hasCurrentProbeContextEvidence(entry, '/synthetic/account')).toBe(false)
    const second = store.recordSuccess(
      'synthetic-home',
      'codex',
      await probe('/synthetic/account')
    )!
    overlay = { ...overlay, HOME: '/synthetic/changed-home' }
    expect(store.hasCurrentProbeContextEvidence(second, '/synthetic/account')).toBe(false)
  })

  it('revokes removal of an inherited variable', async () => {
    vi.stubEnv('ORCA_PROBE_REMOVED_TEST', 'before')
    const state = await fixture()
    expect(state.isCurrent()).toBe(true)
    delete process.env.ORCA_PROBE_REMOVED_TEST
    expect(state.isCurrent()).toBe(false)
  })

  it('refuses conflicting Windows PATH spellings regardless of insertion order', async () => {
    const platform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    try {
      for (const overlay of [
        { PATH: 'C:\\first', Path: 'C:\\second', pAtH: 'C:\\third' },
        { pAtH: 'C:\\third', Path: 'C:\\second', PATH: 'C:\\first' }
      ]) {
        const store = new AgentModelCatalogStore()
        const success = await createCodexModelCatalogProbe({
          resolveEnvironment: async () => overlay,
          readCurrentEnvironment: () => overlay,
          resolveCommand: () => '/synthetic/codex',
          readCurrentContext: () => ({ status: 'known', key: 'synthetic-account' }),
          runSession: async (_invocation, body) =>
            body({
              request: async () => ({ data: [MODEL_ROW], nextCursor: null }),
              notify: () => {}
            })
        })('/synthetic/account')
        const entry = store.recordSuccess('synthetic-windows', 'codex', success)!
        expect(store.hasCurrentProbeContextEvidence(entry, '/synthetic/account')).toBe(false)
      }
    } finally {
      Object.defineProperty(process, 'platform', { value: platform, configurable: true })
    }
  })

  it('refuses environment-only evidence without the independent account reader', async () => {
    const resolver = createStructuredAgentEnvironmentResolvers({
      resolveEnvironment: async () => ({ PATH: '/bin' })
    })
    const store = new AgentModelCatalogStore()
    const success = await createCodexModelCatalogProbe({
      resolveEnvironment: resolver.resolveCodexEnvironment,
      readCurrentEnvironment: resolver.readCurrentCodexEnvironment,
      resolveCommand: () => '/bin/codex',
      runSession: async (_invocation, body) =>
        body({ request: async () => ({ data: [MODEL_ROW], nextCursor: null }), notify: () => {} })
    })('/synthetic/account')
    const entry = store.recordSuccess('synthetic-a', 'codex', success)!
    expect(store.hasCurrentProbeContextEvidence(entry, '/synthetic/account')).toBe(false)
  })

  it.each([() => null, () => ({ BAD: 42 }), () => Promise.reject(new Error('private'))])(
    'refuses unsupported synchronous runtime observations',
    async (readLaunchEnvOverlay) => {
      const state = await fixture({ readLaunchEnvOverlay })
      expect(state.isCurrent()).toBe(false)
    }
  )
})
