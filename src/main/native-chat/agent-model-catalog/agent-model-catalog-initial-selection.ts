import { createHash, randomUUID } from 'node:crypto'
import type { StructuredAgentSessionInitialOptions } from '../../../shared/structured-agent-session-create'
import {
  agentModelCatalogFingerprint,
  type AgentModelCatalogIdentity
} from './agent-model-catalog-fingerprint'
import {
  AGENT_MODEL_CATALOG_FRESH_MS,
  AGENT_MODEL_CATALOG_MAX_ENTRIES,
  type AgentModelCatalogEntry,
  type AgentModelCatalogStore
} from './agent-model-catalog-store'

/** HOST-resolved scope, never a renderer assertion. The future create handler
 * must pin this same account and consult durable replay BEFORE this gate. */
export type InitialSelectionCatalogContext = {
  ownerKey: string
  executionHostId: string
  workspaceId: string
  workspacePath: string
  policyVersion: string
  account: AgentModelCatalogIdentity
}

type CatalogChoice = { model: string; efforts: string[] }
type Refusal = {
  status: 'refused'
  reason: 'catalog-unavailable' | 'scope-changed' | 'catalog-changed' | 'selection-unavailable'
}
type IssuedEvidence = {
  status: 'ready'
  catalogRef: string
  choicesVersion: string
  choices: CatalogChoice[]
}
type SavedEvidence = { scope: string; entry: AgentModelCatalogEntry; choicesVersion: string }
type DraftReadInput = {
  context: InitialSelectionCatalogContext
  catalogRef: string
  choicesVersion: string
}
type DraftChoices = { status: 'ready'; choices: CatalogChoice[] }
type ValidationInput = {
  context: InitialSelectionCatalogContext
  catalogRef: string
  /** Analyze may echo its version; the create wire needs only the opaque ref. */
  choicesVersion?: string
  selection: StructuredAgentSessionInitialOptions
}
type ValidatedSelection = {
  status: 'validated'
  initialOptions: StructuredAgentSessionInitialOptions
}
type UnknownEvidence = { status: 'unknown'; reason: 'reconciliation-required' }

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function optionToken(value: string): boolean {
  return value.length > 0 && value.length <= 512 && /^\S+$/u.test(value)
}

function scopeDigest(context: InitialSelectionCatalogContext): string | null {
  const { account } = context
  if (
    account.agent !== 'codex' ||
    account.accountHomeVariable !== 'CODEX_HOME' ||
    account.wslDistro !== null ||
    [
      context.ownerKey,
      context.executionHostId,
      context.workspaceId,
      context.workspacePath,
      context.policyVersion,
      account.accountHomePath
    ].some((value) => value.trim().length === 0)
  ) {
    return null
  }
  return digest([
    context.ownerKey,
    context.executionHostId,
    context.workspaceId,
    context.workspacePath,
    context.policyVersion,
    agentModelCatalogFingerprint(account)
  ])
}

function normalizedChoices(entry: AgentModelCatalogEntry): CatalogChoice[] | null {
  if (entry.models.length === 0) {
    return null
  }
  const models = new Set<string>()
  const choices: CatalogChoice[] = []
  for (const model of entry.models) {
    if (!optionToken(model.id) || models.has(model.id) || model.efforts.length === 0) {
      return null
    }
    models.add(model.id)
    const efforts = model.efforts.map((effort) => effort.value)
    if (
      efforts.some((effort) => !optionToken(effort)) ||
      new Set(efforts).size !== efforts.length
    ) {
      return null
    }
    choices.push({ model: model.id, efforts: efforts.sort() })
  }
  return choices.sort((a, b) => (a.model < b.model ? -1 : a.model > b.model ? 1 : 0))
}

/** Bounded host memory only. A validated result permits only a
 * first reservation; it says nothing about whether an operation already ran.
 * Missing references (including restart/eviction) require durable reconciliation,
 * never fresh IDs, automatic default selection or an assertion of no creation. */
export function createInitialSelectionCatalogEvidence(deps: {
  store: AgentModelCatalogStore
  now?: () => number
}): {
  readForDraft: (input: DraftReadInput) => DraftChoices | Refusal | UnknownEvidence
  issue: (context: InitialSelectionCatalogContext) => IssuedEvidence | Refusal
  validateNewCreate: (input: ValidationInput) => ValidatedSelection | Refusal | UnknownEvidence
} {
  const now = deps.now ?? Date.now
  const references = new Map<string, SavedEvidence>()

  const read = (context: InitialSelectionCatalogContext) => {
    const scope = scopeDigest(context)
    if (scope === null) {
      return null
    }
    const fingerprint = agentModelCatalogFingerprint(context.account)
    const entry = deps.store.get(fingerprint)
    if (
      !entry ||
      entry.agent !== 'codex' ||
      (entry.origin !== 'probe' && entry.origin !== 'live-session') ||
      !deps.store.hasCurrentProbeContextEvidence(entry, context.account.accountHomePath) ||
      deps.store.hasActiveFailure(fingerprint)
    ) {
      return null
    }
    const at = now()
    if (
      !Number.isFinite(at) ||
      at < 0 ||
      !Number.isFinite(entry.fetchedAt) ||
      entry.fetchedAt < 0 ||
      at < entry.fetchedAt ||
      at - entry.fetchedAt >= AGENT_MODEL_CATALOG_FRESH_MS
    ) {
      return null
    }
    const choices = normalizedChoices(entry)
    if (!choices) {
      return null
    }
    return {
      scope,
      entry,
      choices,
      choicesVersion: digest([scope, entry.origin, entry.fetchedAt, choices])
    }
  }

  const resolveReference = (
    input: Omit<ValidationInput, 'selection'>
  ): DraftChoices | Refusal | UnknownEvidence => {
    const pinned = { ...input.context, account: { ...input.context.account } }
    const catalogRef = input.catalogRef
    const choicesVersion = input.choicesVersion
    const saved = references.get(catalogRef)
    if (!saved) {
      return { status: 'unknown', reason: 'reconciliation-required' }
    }
    const refuse = (reason: Refusal['reason']): Refusal => {
      references.delete(catalogRef)
      return { status: 'refused', reason }
    }
    if (scopeDigest(pinned) !== saved.scope) {
      return refuse('scope-changed')
    }
    const current = read(pinned)
    if (references.get(catalogRef) !== saved) {
      return { status: 'unknown', reason: 'reconciliation-required' }
    }
    if (!current) {
      return refuse('catalog-unavailable')
    }
    if (
      current.entry !== saved.entry ||
      current.choicesVersion !== saved.choicesVersion ||
      (choicesVersion !== undefined && choicesVersion !== saved.choicesVersion)
    ) {
      return refuse('catalog-changed')
    }
    return { status: 'ready', choices: current.choices }
  }

  return {
    readForDraft(input) {
      const choicesVersion = input.choicesVersion
      if (typeof choicesVersion !== 'string' || !optionToken(choicesVersion)) {
        return { status: 'refused', reason: 'catalog-changed' }
      }
      return resolveReference({ ...input, choicesVersion })
    },
    issue(context) {
      const pinned = { ...context, account: { ...context.account } }
      const current = read(pinned)
      if (!current) {
        return { status: 'refused', reason: 'catalog-unavailable' }
      }
      const catalogRef = randomUUID()
      if (references.has(catalogRef)) {
        return { status: 'refused', reason: 'catalog-unavailable' }
      }
      references.set(catalogRef, {
        scope: current.scope,
        entry: current.entry,
        choicesVersion: current.choicesVersion
      })
      if (references.size > AGENT_MODEL_CATALOG_MAX_ENTRIES) {
        const oldest = references.keys().next().value
        if (oldest !== undefined) {
          references.delete(oldest)
        }
      }
      return {
        status: 'ready',
        catalogRef,
        choicesVersion: current.choicesVersion,
        choices: current.choices
      }
    },
    validateNewCreate(input) {
      const context = { ...input.context, account: { ...input.context.account } }
      const selection = { ...input.selection }
      const catalogRef = input.catalogRef
      const choicesVersion = input.choicesVersion
      const current = resolveReference({ context, catalogRef, choicesVersion })
      if (current.status !== 'ready') {
        return current
      }
      const refuse = (reason: Refusal['reason']): Refusal => {
        references.delete(catalogRef)
        return { status: 'refused', reason }
      }
      const model = current.choices.find((choice) => choice.model === selection.model)
      if (!model?.efforts.includes(selection.effort)) {
        return refuse('selection-unavailable')
      }
      return {
        status: 'validated',
        initialOptions: {
          model: selection.model,
          effort: selection.effort
        }
      }
    }
  }
}
