import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { SettingsSwitchRow } from './SettingsFormControls'
import { translate } from '@/i18n/i18n'

export function getAgentTabPresentationCopy() {
  return {
    background: translate(
      'settings.agents.phaseBackground',
      'Automatic conversation phase backgrounds'
    ),
    backgroundDescription: translate(
      'settings.agents.phaseBackgroundDescription',
      'Show the last phase supported by session events. Verification color does not mean checks passed.'
    ),
    icon: translate('settings.agents.statusIcon', 'Agent status icons on conversation tabs'),
    iconDescription: translate(
      'settings.agents.statusIconDescription',
      'Show activity, input requests and response outcomes beside the provider logo.'
    )
  }
}

export function AgentTabPresentationSettings({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}) {
  const copy = getAgentTabPresentationCopy()
  return (
    <section className="space-y-3">
      <SettingsSwitchRow
        label={copy.background}
        description={copy.backgroundDescription}
        ariaLabel={copy.background}
        checked={settings.tabAutoPhaseBackground !== false}
        onChange={() =>
          updateSettings({ tabAutoPhaseBackground: settings.tabAutoPhaseBackground === false })
        }
      />
      <SettingsSwitchRow
        label={copy.icon}
        description={copy.iconDescription}
        ariaLabel={copy.icon}
        checked={settings.tabAgentStatusIcon !== false}
        onChange={() =>
          updateSettings({ tabAgentStatusIcon: settings.tabAgentStatusIcon === false })
        }
      />
    </section>
  )
}
