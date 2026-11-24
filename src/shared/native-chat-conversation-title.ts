import { isKnownHarnessInjectedUserTurnText } from './harness-injected-user-turns'
import { deriveGeneratedTabTitle } from './agent-tab-title'
import type { AgentSessionConversationOutline } from './agent-session-conversation-outline'

const ACKNOWLEDGEMENTS = new Set([
  'ok',
  'okay',
  'da',
  'yes',
  'yeah',
  'sure',
  'bine',
  'perfect',
  'thanks',
  'multumesc',
  'merci'
])
const CONTINUATIONS = new Set([
  '',
  'continua',
  'continue',
  'proceed',
  'go ahead',
  'executa',
  'aprob',
  'autorizez',
  'ai acordul',
  'ai acordul meu',
  'you have my approval',
  'hai sa continuam',
  'inspecteaza si rezolva'
])

function isContinuation(preview: string): boolean {
  const words = preview
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[.!?,]/g, ' ')
    .trim()
    .split(/\s+/)
  let start = 0
  while (ACKNOWLEDGEMENTS.has(words[start])) {
    start++
  }
  return CONTINUATIONS.has(words.slice(start).join(' '))
}

export function deriveNativeChatConversationTitle(
  outline: AgentSessionConversationOutline
): string | null {
  // An outline trimmed by the host cannot prove where the conversation began.
  if (outline.omittedEntries > 0) {
    return null
  }
  for (const entry of outline.entries) {
    const preview = entry.preview.trim()
    if (
      !preview ||
      isKnownHarnessInjectedUserTurnText(preview) ||
      isContinuation(preview) ||
      /^(?:#\s*AGENTS\.md instructions|<INSTRUCTIONS>|<environment_context>)/i.test(preview)
    ) {
      continue
    }
    const title = deriveGeneratedTabTitle(preview)
    if (title) {
      return title
    }
  }
  return null
}
