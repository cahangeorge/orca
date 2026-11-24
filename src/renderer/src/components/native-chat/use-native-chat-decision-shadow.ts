import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DecisionShadowReadResult } from '../../../../shared/decision-shadow-wire'
import type { RuntimeClientTarget } from '../../runtime/runtime-rpc-client'
import { configureDecisionShadow, readDecisionShadow } from '../../runtime/decision-shadow-client'
const OFF: DecisionShadowReadResult = { mode: 'off', observations: [] }
type Scope = {
  key: string
  active: boolean
  version: number
  enabled: boolean
  pending: boolean
  schedulePoll: () => void
  cancelPoll: () => void
  poll: () => void
  target: RuntimeClientTarget
  sessionId: string
}
// Automatic cleanup must not turn off another view's newer opt-in for the same session.
const mountedScopes = new Map<string, Set<Scope>>()
function disableOwnedShadow(scope: Scope): void {
  const peers = mountedScopes.get(scope.key)
  if ([...(peers ?? [])].some((peer) => peer !== scope && (peer.enabled || peer.pending))) {
    return
  }
  void configureDecisionShadow(scope.target, scope.sessionId, false).catch(() => {})
}
export function useNativeChatDecisionShadow(target: RuntimeClientTarget, sessionId: string) {
  const environmentId = target.kind === 'local' ? null : target.environmentId
  const stableTarget = useMemo<RuntimeClientTarget>(
    () => (environmentId === null ? { kind: 'local' } : { kind: 'environment', environmentId }),
    [environmentId]
  )
  const key = `${stableTarget.kind}:${environmentId ?? ''}:${sessionId}`
  const scopeRef = useRef<Scope | null>(null)
  const [view, setView] = useState({
    key,
    snapshot: OFF,
    loading: stableTarget.kind === 'local',
    configuring: false,
    error: false
  })
  useEffect(() => {
    const scope: Scope = {
      key,
      active: true,
      version: 0,
      enabled: false,
      pending: false,
      target: stableTarget,
      sessionId,
      poll: () => {},
      schedulePoll: () => {},
      cancelPoll: () => {}
    }
    const peers = mountedScopes.get(key) ?? new Set<Scope>()
    peers.add(scope)
    mountedScopes.set(key, peers)
    scopeRef.current = scope
    setView({
      key,
      snapshot: OFF,
      loading: stableTarget.kind === 'local',
      configuring: false,
      error: false
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    scope.cancelPoll = () => {
      clearTimeout(timer)
      timer = undefined
    }
    scope.schedulePoll = () => {
      scope.cancelPoll()
      if (scope.active && scope.enabled) {
        timer = setTimeout(scope.poll, 1000)
      }
    }
    const disable = () => disableOwnedShadow(scope)
    const read = async () => {
      const version = scope.version
      try {
        const snapshot = await readDecisionShadow(stableTarget, sessionId)
        if (!scope.active) {
          if (snapshot.mode === 'shadow') {
            disable()
          }
          return
        }
        if (version !== scope.version) {
          return
        }
        scope.enabled = snapshot.mode === 'shadow'
        setView({ key, snapshot, loading: false, configuring: false, error: false })
        if (scope.enabled) {
          scope.schedulePoll()
        }
      } catch {
        if (!scope.active || version !== scope.version) {
          return
        }
        if (scope.enabled) {
          disable()
        }
        scope.enabled = false
        setView({ key, snapshot: OFF, loading: false, configuring: false, error: true })
      }
    }
    scope.poll = () => {
      if (scope.active && scope.enabled) {
        void read()
      }
    }
    if (stableTarget.kind === 'local') {
      void read()
    }
    return () => {
      scope.active = false
      scope.cancelPoll()
      peers.delete(scope)
      if (!peers.size) {
        mountedScopes.delete(key)
      }
      if (scope.enabled || scope.pending) {
        disable()
      }
    }
  }, [key, sessionId, stableTarget])
  const configure = useCallback(
    async (enabled: boolean) => {
      const scope = scopeRef.current
      if (!scope?.active || scope.target.kind !== 'local') {
        return
      }
      const version = ++scope.version
      scope.cancelPoll()
      scope.pending = enabled
      if (!enabled) {
        scope.enabled = false
      }
      setView((previous) => ({
        ...previous,
        snapshot: enabled ? previous.snapshot : OFF,
        configuring: true,
        error: false
      }))
      try {
        const snapshot = await configureDecisionShadow(scope.target, scope.sessionId, enabled)
        if (!scope.active || version !== scope.version) {
          if (enabled) {
            disableOwnedShadow(scope)
          }
          return
        }
        scope.pending = false
        scope.enabled = snapshot.mode === 'shadow'
        setView({ key, snapshot, loading: false, configuring: false, error: false })
        if (scope.enabled) {
          scope.schedulePoll()
        }
      } catch {
        if (!scope.active || version !== scope.version) {
          return
        }
        scope.pending = false
        scope.enabled = false
        disableOwnedShadow(scope)
        setView({ key, snapshot: OFF, loading: false, configuring: false, error: true })
      }
    },
    [key]
  )
  return {
    ...(view.key === key
      ? view
      : {
          key,
          snapshot: OFF,
          loading: stableTarget.kind === 'local',
          configuring: false,
          error: false
        }),
    configure
  }
}
