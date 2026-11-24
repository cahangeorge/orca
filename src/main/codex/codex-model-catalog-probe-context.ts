import type { CodexAppServerInvocation } from './codex-app-server-session'

export type CodexModelCatalogProbeContext = {
  readonly invocation: Readonly<Omit<CodexAppServerInvocation, 'args' | 'env'>> & {
    readonly args: readonly string[]
    readonly env?: Readonly<Record<string, string>>
  }
  readonly accountHomePath: string
}

/** Trusted synchronous host seam: freshly observe current launch AND account provenance
 * agreeing with the pinned invocation. An input digest alone is not provenance.
 * No production reader exists yet; absent/unknown evidence refuses selection. */
export type CodexModelCatalogProbeContextReader = (
  context: CodexModelCatalogProbeContext
) => unknown

type Receipt = {
  context: CodexModelCatalogProbeContext
  reader: CodexModelCatalogProbeContextReader
  key: string
  valid: boolean
}
const receipts = new WeakMap<object, Receipt>()

function observe(
  reader: CodexModelCatalogProbeContextReader | undefined,
  context: CodexModelCatalogProbeContext
): string | null {
  try {
    const value = reader?.(context)
    if (typeof value !== 'object' || value === null) {
      return null
    }
    if ('then' in value) {
      // Async readers cannot prove a synchronous gate; consume rejection privately.
      void Promise.resolve(value).catch(() => {})
      return null
    }
    const status = 'status' in value ? value.status : undefined
    const key = 'key' in value ? value.key : undefined
    if (
      status === 'known' &&
      typeof key === 'string' &&
      key.length <= 512 &&
      key.trim().length > 0
    ) {
      return key
    }
  } catch {
    return null
  }
  return null
}

export function beginCodexModelCatalogProbeContext(
  invocation: CodexAppServerInvocation,
  accountHomePath: string,
  reader?: CodexModelCatalogProbeContextReader
): (success: object) => void {
  Object.freeze(invocation.args)
  Object.freeze(invocation.env)
  Object.freeze(invocation)
  const context = Object.freeze({ invocation, accountHomePath })
  const before = observe(reader, context)
  let completed = false
  return (success) => {
    if (completed) {
      return
    }
    completed = true
    const after = observe(reader, context)
    if (reader && before !== null && after === before) {
      receipts.set(success, { context, reader, key: before, valid: true })
    }
  }
}

export function transferCodexModelCatalogProbeContext(source: object, entry: object): void {
  const receipt = receipts.get(source)
  receipts.delete(source)
  if (receipt?.valid) {
    receipts.set(entry, receipt)
  }
}

export function revokeCodexModelCatalogProbeContext(entry: object): void {
  const receipt = receipts.get(entry)
  if (receipt) {
    receipt.valid = false
  }
  receipts.delete(entry)
}

export function hasCurrentCodexModelCatalogProbeContext(
  entry: object,
  accountHomePath: string
): boolean {
  const receipt = receipts.get(entry)
  if (!receipt?.valid) {
    return false
  }
  if (
    receipt.context.accountHomePath !== accountHomePath ||
    receipt.context.invocation.env?.CODEX_HOME !== accountHomePath ||
    observe(receipt.reader, receipt.context) !== receipt.key
  ) {
    receipt.valid = false
    receipts.delete(entry)
    return false
  }
  return receipt.valid && receipts.get(entry) === receipt
}
