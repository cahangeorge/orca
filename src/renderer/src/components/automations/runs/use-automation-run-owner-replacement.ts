import { useCallback, useEffect } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store/index'
import type { AutomationCapturedOwner } from '../hosts/automation-captured-owner'
import type { AutomationsPageLocalState } from '../use-automations-page-local-state'
import {
  automationRunLinkOwnerChanged,
  reportReplacedAutomationRunOwner
} from './automation-run-link-row'

export function useAutomationRunOwnerReplacement(
  {
    pageView,
    runNotFound,
    runVisit,
    setBlockedRunHistory,
    setRunVisit,
    setSelectedAutomationRunPageId,
    setIsDetailOpen,
    setPageView
  }: Pick<
    AutomationsPageLocalState,
    | 'pageView'
    | 'runNotFound'
    | 'runVisit'
    | 'setBlockedRunHistory'
    | 'setRunVisit'
    | 'setSelectedAutomationRunPageId'
    | 'setIsDetailOpen'
    | 'setPageView'
  >,
  capturedOwners: ReadonlyMap<string, AutomationCapturedOwner>
): () => void {
  const t = useTranslate()
  const leaveReplacedRun = useCallback((): void => {
    setRunVisit(null)
    setSelectedAutomationRunPageId(null)
    setIsDetailOpen(false)
    setPageView('automations')
    reportReplacedAutomationRunOwner(t)
  }, [setRunVisit, setSelectedAutomationRunPageId, setIsDetailOpen, setPageView, t])

  useEffect(() => {
    if (
      pageView === 'run' &&
      !runNotFound &&
      runVisit &&
      !useAppStore.getState().pendingAutomationRunNavigation &&
      automationRunLinkOwnerChanged(runVisit, capturedOwners)
    ) {
      setBlockedRunHistory(runVisit)
      leaveReplacedRun()
    }
  }, [pageView, runNotFound, runVisit, capturedOwners, setBlockedRunHistory, leaveReplacedRun])

  return leaveReplacedRun
}
