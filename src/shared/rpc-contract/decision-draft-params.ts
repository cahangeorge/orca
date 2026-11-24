import { z } from 'zod'
const identifier = z.string().min(1).max(256).regex(/^\S+$/u)
const integer = z.number().int().nonnegative().refine(Number.isSafeInteger)
export const DecisionDraftCancelParams = z
  .object({ workspaceId: identifier, draftId: identifier, revision: integer })
  .strict()
export const DecisionDraftAnalyzeParams = DecisionDraftCancelParams.extend({
  catalogRef: identifier,
  choicesVersion: identifier,
  text: z
    .string()
    .max(4096)
    .refine((text) => text.trim().length > 0),
  attachmentCount: integer,
  selfContained: z.boolean(),
  inputTruncated: z.boolean(),
  explicitSelection: z.object({ model: identifier, effort: identifier }).strict().optional()
}).strict()
export type DecisionDraftAnalyzeInput = z.infer<typeof DecisionDraftAnalyzeParams>
