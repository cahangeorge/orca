import type {
  DecisionShadowDispatch,
  DecisionShadowReason
} from '../../shared/decision-shadow-types'
export function sanitizeDecisionShadowText(text: string): string {
  return text
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, '[url]')
    .replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g, '[email]')
    .replace(/(?:[A-Za-z]:\\|\/|~\/)[\w.\\/-]+/g, '[path]')
    .replace(
      /['"]?\b(?:token|password|secret|api[_-]?key|authorization)['"]?\s*[:=]\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\r\n,;}]+)/gi,
      '[credential]'
    )
    .replace(/\b(?:sk-|ghp_|github_pat_|AKIA)[A-Za-z0-9_-]+/g, '[credential]')
    .replace(/\bBearer\s+\S+/gi, '[credential]')
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
      '[credential]'
    )
    .replace(/\s/g, ' ')
    .trim()
}
export function decisionShadowExclusion(
  input: DecisionShadowDispatch
): DecisionShadowReason | undefined {
  if (input.activeTurn) {
    return 'active_turn'
  }
  if (/^\s*(?:\/|\$[a-z][\w-]*)/i.test(input.text)) {
    return 'command'
  }
  if (input.inputTruncated || input.text.length + (input.context?.length ?? 0) > 4096) {
    return 'truncated'
  }
  if (
    !input.autonomous ||
    input.text.trim().length < 24 ||
    /^\s*(?:continue|continu[ăa]|resume|same as|as above|see (?:above|previous))(?=\s|$|[.,;:!?])/iu.test(
      input.text
    )
  ) {
    return 'needs_context'
  }
  if (!input.availableLanes.length) {
    return 'no_available_lane'
  }
  return undefined
}
