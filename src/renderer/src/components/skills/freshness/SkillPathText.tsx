import { Fragment } from 'react'
import { toast } from 'sonner'
import { Copy } from 'lucide-react'
import { collapseHomePath } from '../../../../../shared/skills/bundled/bundled-skill-locations'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '@/components/ui/button'

/**
 * A host path in a skill result: shown from `~/` when it is under the host's home, wrapping only
 * after a separator or a hyphen (never inside a name), with the full path in the tooltip and on copy.
 */
export function SkillPathText({
  path,
  homeDirectory,
  className
}: {
  path: string
  homeDirectory?: string
  className?: string
}): React.JSX.Element {
  const shown = homeDirectory ? collapseHomePath(path, homeDirectory) : path
  const parts = shown.split(/(?<=[\\/-])/u)
  return (
    <span
      className={cn(
        'min-w-0 select-text font-mono text-2xs leading-5 text-muted-foreground [overflow-wrap:anywhere]',
        className
      )}
      title={path}
      onCopy={(event) => {
        // Copying the whole shown path gives the real one, not the `~` form.
        if (window.getSelection()?.toString() === shown && shown !== path) {
          event.clipboardData.setData('text/plain', path)
          event.preventDefault()
        }
      }}
    >
      {parts.map((part, index) => (
        <Fragment key={index}>
          {part}
          {index < parts.length - 1 ? <wbr /> : null}
        </Fragment>
      ))}
    </span>
  )
}

/**
 * A retained path the user may need to act on, with a keyboard-reachable Copy path that copies
 * the full host path (not the `~` form). For a copy no later plan mentions, this is its only receipt.
 */
export function SkillRetainedPathLine({
  path,
  homeDirectory,
  className
}: {
  path: string
  homeDirectory?: string
  className?: string
}): React.JSX.Element {
  const t = useTranslate()
  const copyLabel = t('auto.components.skills.SkillRow.copyPath', 'Copy path')
  const copyPath = async (): Promise<void> => {
    try {
      await window.api.ui.writeClipboardText(path)
      toast.success(t('auto.components.skills.SkillRow.pathCopied', 'Path copied'))
    } catch {
      // The path stays on screen, so the user can try again.
    }
  }
  return (
    <div className={cn('flex min-w-0 items-start gap-1.5', className)}>
      <SkillPathText path={path} homeDirectory={homeDirectory} className="flex-1" />
      {/* Icon-only so the path keeps the column; always visible so Tab reaches it. */}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="shrink-0"
        aria-label={copyLabel}
        title={copyLabel}
        onClick={() => void copyPath()}
      >
        <Copy />
      </Button>
    </div>
  )
}
