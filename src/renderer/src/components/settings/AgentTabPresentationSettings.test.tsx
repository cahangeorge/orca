import { describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import { AgentTabPresentationSettings } from './AgentTabPresentationSettings'

describe('independent conversation presentation settings', () => {
  it('changes only the selected setting without depending on generated titles', () => {
    const updateSettings = vi.fn()
    const element = AgentTabPresentationSettings({
      settings: { ...getDefaultSettings('/tmp'), tabAutoGenerateTitle: false },
      updateSettings
    })
    const [background, icon] = element.props.children
    expect(background.props.checked).toBe(true)
    background.props.onChange()
    expect(updateSettings).toHaveBeenLastCalledWith({ tabAutoPhaseBackground: false })
    icon.props.onChange()
    expect(updateSettings).toHaveBeenLastCalledWith({ tabAgentStatusIcon: false })
  })
})
