import {
  DecisionShadowReadParams as ReadParams,
  DecisionShadowConfigureParams as ConfigureParams
} from '../../../../shared/rpc-contract/decision-shadow-params'
import { defineMethod, type RpcContext } from '../core'
import {
  requireStructuredCleanupHost,
  requireStructuredHost,
  structuredCallerFor
} from './structured-agent-session-gate'
import { decisionShadowRuntimeFor } from '../../../decision-shadow/decision-shadow-runtime'

export function requireLocalDecisionShadowCaller(ctx: RpcContext): string {
  if (
    ctx.clientKind !== 'runtime' ||
    ctx.clientId !== 'desktop-renderer' ||
    ctx.pairedDeviceId !== undefined ||
    !ctx.connectionId?.trim()
  ) {
    throw new Error('Decision shadow requires the local desktop caller')
  }
  return structuredCallerFor(ctx).callerKey
}
export const STRUCTURED_AGENT_SESSION_DECISION_SHADOW_METHODS = [
  defineMethod({
    name: 'agentSession.decisionShadowRead',
    params: ReadParams,
    handler: (params, ctx) => {
      const ownerId = requireLocalDecisionShadowCaller(ctx)
      const host = requireStructuredHost(ctx)
      return (
        decisionShadowRuntimeFor(host)?.read(params.sessionId, ownerId) ?? {
          mode: 'off' as const,
          observations: []
        }
      )
    }
  }),
  defineMethod({
    name: 'agentSession.decisionShadowConfigure',
    params: ConfigureParams,
    handler: (params, ctx) => {
      const ownerId = requireLocalDecisionShadowCaller(ctx)
      const host = params.enabled ? requireStructuredHost(ctx) : requireStructuredCleanupHost(ctx)
      const runtime = decisionShadowRuntimeFor(host)
      if (!runtime?.configure(params.sessionId, ownerId, params.enabled)) {
        throw new Error('Decision shadow unavailable for this local Codex session')
      }
      return runtime.read(params.sessionId, ownerId)
    }
  })
]
