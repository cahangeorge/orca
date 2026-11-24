import type { RpcContext } from '../core'
import type { SelectedCreateHostScope } from '../../agent-session-selected-first-reservation'
import type { StructuredAgentSessionCreateParams } from '../../../../shared/structured-agent-session-create'
import {
  CreateIntentParams,
  ExecutionLocation,
  AccountHome
} from '../../../../shared/rpc-contract/structured-agent-session-params'
import {
  AGENT_SESSION_MAX_OPERATION_REPLAY_AGE_MS,
  AGENT_SESSION_OPERATION_FUTURE_SKEW_MS,
  parseAgentSessionOperationTimestamp
} from '../../../../shared/agent-session-host-authority'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import { requireLocalDecisionShadowCaller } from './structured-agent-session-decision-shadow'
import { supportsStructuredAgentSessions } from './structured-agent-session-policy'

/** Version of this local read policy, not effective Codex model/permission policy. */
export const SELECTED_CREATE_LOCAL_POLICY_VERSION = 'selected-create-local-1'
export type SelectedCreateScopeResult =
  | {
      decision: 'scoped'
      admission: 'unproven'
      scope: SelectedCreateHostScope
      request: StructuredAgentSessionCreateParams
    }
  | { decision: 'unknown' | 'conflict'; reason: string }

function unknownScope(): SelectedCreateScopeResult {
  return { decision: 'unknown', reason: 'host-scope-unavailable' }
}
function validClock(at: number, timestamp: number): boolean {
  return (
    Number.isSafeInteger(at) &&
    at >= 0 &&
    timestamp <= at + AGENT_SESSION_OPERATION_FUTURE_SKEW_MS &&
    at - timestamp <= AGENT_SESSION_MAX_OPERATION_REPLAY_AGE_MS
  )
}
function callerBinding(ctx: RpcContext): string | null {
  if (ctx.signal?.aborted || !supportsStructuredAgentSessions(ctx)) {
    return null
  }
  return JSON.stringify([
    requireLocalDecisionShadowCaller(ctx),
    ctx.connectionId,
    SELECTED_CREATE_LOCAL_POLICY_VERSION
  ])
}

/** Internal sampled candidate only; no catalog authorization, first-attempt proof or launch grant. */
export async function resolveSelectedCreateHostScope(
  request: unknown,
  ctx: RpcContext,
  now: () => number = Date.now
): Promise<SelectedCreateScopeResult> {
  try {
    const parsed = CreateIntentParams.safeParse(structuredClone(request))
    if (
      !parsed.success ||
      parsed.data.agent !== 'codex' ||
      !parsed.data.initialOptions ||
      parsed.data.resumeFrom !== undefined ||
      parsed.data.envelope.expectedRuntimeFence !== null
    ) {
      return { decision: 'conflict', reason: 'request-malformed' }
    }
    const intent = parsed.data
    const timestamp = parseAgentSessionOperationTimestamp(intent.envelope.clientOperationId)
    const before = now()
    const binding = callerBinding(ctx)
    if (!binding || timestamp === null || !validClock(before, timestamp)) {
      return unknownScope()
    }
    const runtime = ctx.runtime
    const read = async (): Promise<SelectedCreateHostScope | null> => {
      const current = await runtime.resolveStructuredAgentSessionSelectionScope(intent.worktree)
      if (!current) {
        return null
      }
      const location = ExecutionLocation.safeParse(current.location)
      const home = AccountHome.safeParse(current.accountHome)
      if (
        !location.success ||
        location.data.executionHostId !== LOCAL_EXECUTION_HOST_ID ||
        location.data.wslDistro !== null ||
        !home.success ||
        home.data.variable !== 'CODEX_HOME' ||
        !home.data.path.trim() ||
        !current.workspacePath?.trim()
      ) {
        return null
      }
      return {
        callerKey: requireLocalDecisionShadowCaller(ctx),
        location: location.data,
        accountHome: home.data,
        workspacePath: current.workspacePath,
        policyVersion: SELECTED_CREATE_LOCAL_POLICY_VERSION
      }
    }
    const first = await read()
    if (!first || callerBinding(ctx) !== binding || ctx.runtime !== runtime) {
      return unknownScope()
    }
    const second = await read()
    const after = now()
    if (
      !second ||
      JSON.stringify(first) !== JSON.stringify(second) ||
      callerBinding(ctx) !== binding ||
      ctx.runtime !== runtime ||
      after < before ||
      !validClock(after, timestamp)
    ) {
      return unknownScope()
    }
    return { decision: 'scoped', admission: 'unproven', scope: second, request: intent }
  } catch {
    return unknownScope()
  }
}
