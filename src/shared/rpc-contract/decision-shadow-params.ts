import { z } from 'zod'
export const DecisionShadowReadParams = z.object({ sessionId: z.string().min(1) }).strict()
export const DecisionShadowConfigureParams = DecisionShadowReadParams.extend({
  enabled: z.boolean()
}).strict()
