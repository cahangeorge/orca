import {
  decisionShadowReadResultSchema,
  type DecisionShadowReadResult
} from '../../../shared/decision-shadow-wire'
import { callRuntimeRpc, type RuntimeClientTarget } from './runtime-rpc-client'
async function call(
  target: RuntimeClientTarget,
  method: string,
  params: unknown
): Promise<DecisionShadowReadResult> {
  if (target.kind !== 'local') {
    throw new Error('Decision shadow is local only')
  }
  const result = decisionShadowReadResultSchema.safeParse(
    await callRuntimeRpc<unknown>(target, method, params)
  )
  if (!result.success) {
    throw new Error('Decision shadow unavailable')
  }
  return result.data
}
export function readDecisionShadow(
  target: RuntimeClientTarget,
  sessionId: string
): Promise<DecisionShadowReadResult> {
  return call(target, 'agentSession.decisionShadowRead', { sessionId })
}
export function configureDecisionShadow(
  target: RuntimeClientTarget,
  sessionId: string,
  enabled: boolean
): Promise<DecisionShadowReadResult> {
  return call(target, 'agentSession.decisionShadowConfigure', { sessionId, enabled })
}
