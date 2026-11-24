import { z } from 'zod'
import type { DecisionShadowObservation } from './decision-shadow-types'
const lane = z.object({ model: z.string().min(1).max(128), effort: z.string().min(1).max(32) })
const score = z.number().finite().min(0).max(1)
const answer = z.object({
  choice: z.string().min(1).max(256),
  confidence: score.optional(),
  probabilities: z.record(z.string().max(256), score).optional()
})
const observation: z.ZodType<DecisionShadowObservation> = z.object({
  schemaVersion: z.literal(1),
  sessionId: z.string().min(1).max(256),
  ownerId: z.string().min(1).max(256),
  generation: z.string().min(1).max(256),
  fence: z.number().int().nonnegative(),
  decisionId: z.string().min(1).max(256),
  clientMessageId: z.string().min(1).max(256),
  choicesVersion: z.string().max(256),
  policyVersion: z.string().max(256),
  inputDigest: z.string().max(128),
  inputTruncated: z.boolean(),
  calibration: z.literal('uncalibrated'),
  provider: z.string().max(128),
  modelRevision: z.string().max(128),
  createdAt: z.number().finite().nonnegative(),
  latencyMs: z.number().finite().nonnegative().optional(),
  state: z.enum([
    'pending',
    'available',
    'needs_context',
    'skipped',
    'unavailable',
    'expired',
    'cancelled'
  ]),
  reason: z
    .enum([
      'active_turn',
      'command',
      'needs_context',
      'truncated',
      'no_available_lane',
      'queue_full',
      'invalid_response',
      'provider_unavailable',
      'deadline',
      'off',
      'stop',
      'close',
      'replacement'
    ])
    .optional(),
  answers: z.object({ task_category: answer, execution_lane: answer }).optional(),
  requested: lane.optional(),
  reported: lane.optional(),
  turnId: z.string().max(256).optional(),
  deliveryState: z.enum(['dispatched', 'admitted', 'acknowledged', 'rejected', 'unknown'])
})
export const decisionShadowReadResultSchema = z
  .object({ mode: z.enum(['off', 'shadow']), observations: z.array(observation).max(200) })
  .strict()
export type DecisionShadowReadResult = z.infer<typeof decisionShadowReadResultSchema>
