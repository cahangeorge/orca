import type {
  DecisionShadowAnswer,
  DecisionShadowLane
} from '../../../../shared/decision-shadow-types'
import type { RuntimeClientTarget } from '../../runtime/runtime-rpc-client'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useNativeChatDecisionShadow } from './use-native-chat-decision-shadow'
function laneLabel(lane?: DecisionShadowLane) {
  return lane ? `${lane.model} / ${lane.effort}` : 'Unknown'
}
function choiceLane(choice?: string): DecisionShadowLane | undefined {
  if (!choice || choice === 'needs_context') {
    return undefined
  }
  try {
    const value: unknown = JSON.parse(choice)
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      value.every((item) => typeof item === 'string')
    ) {
      return { model: value[0], effort: value[1] }
    }
  } catch {
    /* Invalid choices are unavailable. */
  }
  return undefined
}
function scoreLabel(answer?: DecisionShadowAnswer) {
  if (!answer) {
    return 'Unknown'
  }
  const probability = answer.probabilities?.[answer.choice]
  return (
    [
      answer.confidence === undefined ? null : `confidence ${answer.confidence.toFixed(3)}`,
      probability === undefined ? null : `choice score ${probability.toFixed(3)}`
    ]
      .filter(Boolean)
      .join(' · ') || 'Unknown'
  )
}
export function NativeChatDecisionShadowCard({
  target,
  sessionId
}: {
  target: RuntimeClientTarget
  sessionId: string
}) {
  const { snapshot, loading, configuring, error, configure } = useNativeChatDecisionShadow(
    target,
    sessionId
  )
  const observation = snapshot.observations.at(-1)
  return (
    <section
      aria-label="OpenDecider shadow pilot"
      className="mx-3 mb-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
      data-decision-id={observation?.decisionId}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-foreground">
          OpenDecider shadow pilot · {snapshot.mode === 'shadow' ? 'Shadow' : 'Off'}
        </span>
        <Switch
          aria-label="Enable OpenDecider shadow"
          checked={snapshot.mode === 'shadow'}
          disabled={loading || configuring}
          onCheckedChange={(enabled) => void configure(enabled)}
        />
      </div>
      <p className="mt-1">
        Experimental recommendation only. Codex uses your selected model and effort.
      </p>
      {error ? <p className="mt-1">Shadow unavailable</p> : null}
      {snapshot.mode === 'shadow' ? (
        <Collapsible defaultOpen className="mt-2">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="xs">
              Decision details
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-1" aria-live="polite">
            <div className="space-y-1">
              <p>
                {observation
                  ? `${observation.state}${observation.reason ? ` · ${observation.reason.replaceAll('_', ' ')}` : ''}`
                  : 'Waiting for an autonomous task'}
              </p>
              {observation ? (
                <>
                  <p>
                    {observation.provider === 'simulated-fixture'
                      ? 'Simulated fixture'
                      : 'OpenDecider Nano'}{' '}
                    ·{' '}
                    {observation.latencyMs === undefined
                      ? 'Pending'
                      : `${Math.round(observation.latencyMs)} ms`}
                  </p>
                  <p>Category: {observation.answers?.task_category.choice ?? 'Unknown'}</p>
                  <p>
                    Recommended: {laneLabel(choiceLane(observation.answers?.execution_lane.choice))}
                  </p>
                  <p>
                    Requested: {laneLabel(observation.requested)} · Reported by Codex:{' '}
                    {laneLabel(observation.reported)}
                  </p>
                  <p>Category scores: {scoreLabel(observation.answers?.task_category)}</p>
                  <p>Lane scores: {scoreLabel(observation.answers?.execution_lane)}</p>
                  <p>Uncalibrated scores; they do not measure task success.</p>
                </>
              ) : null}
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </section>
  )
}
