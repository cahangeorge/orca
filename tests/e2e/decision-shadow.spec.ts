import { writeFileSync } from 'node:fs'
import { expect } from './helpers/orca-app'
import {
  test,
  openShadowChat,
  readSyntheticTurns
} from './helpers/decision-shadow-native-chat-fixture'
import { captureShadowHtml, paintShadowScenes } from './helpers/decision-shadow-scene-capture'
import { decisionShadowReadResultSchema } from '../../src/shared/decision-shadow-wire'

const endpoint = process.env.ORCA_DECISION_SHADOW_E2E_ENDPOINT
test('local Native Chat shadow pilot follows actual host dispatch and stays observation only', async ({
  orcaPage,
  electronApp
}, testInfo) => {
  test.setTimeout(endpoint ? 180_000 : 90_000)
  test.skip(process.platform === 'win32', 'POSIX offline app-server fixture')
  const { pane, card, sessionId } = await openShadowChat(orcaPage, electronApp)
  const baselineTask = 'Implement a bounded CSV parser with validation and tests.'
  const baselineStarted = performance.now()
  await pane.getByRole('textbox', { name: 'Send a message…' }).fill(baselineTask)
  await pane.getByRole('textbox', { name: 'Send a message…' }).press('Enter')
  await expect(pane.getByText(/^Offline synthetic response [0-9]+$/)).toHaveCount(1)
  const offCompletionMs = performance.now() - baselineStarted
  const offSnapshot = await orcaPage.evaluate(async (id) => {
    const response = await window.api.runtime.call({
      method: 'agentSession.decisionShadowRead',
      params: { sessionId: id }
    })
    if (!response.ok) {
      throw new Error(response.error.code)
    }
    return response.result
  }, sessionId)
  expect(decisionShadowReadResultSchema.parse(offSnapshot)).toEqual({
    mode: 'off',
    observations: []
  })
  await card.getByRole('switch', { name: 'Enable OpenDecider shadow' }).dispatchEvent('click')
  await expect(card).toContainText('Shadow')
  const observations: ReturnType<typeof decisionShadowReadResultSchema.parse>[] = []
  const visibleLatencyMs: number[] = []
  const shadowCompletionMs: number[] = []
  for (const text of [
    baselineTask,
    'Research official documentation for a simple local cache design.'
  ]) {
    const previous = await card.getAttribute('data-decision-id')
    const started = performance.now()
    await pane.getByRole('textbox', { name: 'Send a message…' }).fill(text)
    await pane.getByRole('textbox', { name: 'Send a message…' }).press('Enter')
    await expect(pane.getByText(/^Offline synthetic response [0-9]+$/)).toHaveCount(
      shadowCompletionMs.length + 2
    )
    shadowCompletionMs.push(performance.now() - started)
    await expect
      .poll(() => card.getAttribute('data-decision-id'), { intervals: [50] })
      .not.toBe(previous)
    await expect(card.getByText('available', { exact: true })).toBeVisible({ timeout: 15_000 })
    visibleLatencyMs.push(performance.now() - started)
    const observation = await orcaPage.evaluate(async (id) => {
      const response = await window.api.runtime.call({
        method: 'agentSession.decisionShadowRead',
        params: { sessionId: id }
      })
      if (!response.ok) {
        throw new Error(response.error.code)
      }
      return response.result
    }, sessionId)
    const parsed = decisionShadowReadResultSchema.parse(observation)
    const latest = parsed.observations.at(-1)
    expect(latest?.state).toBe('available')
    expect(latest?.answers?.execution_lane.choice).toMatch(/^\[/)
    expect(latest?.reported).toBeUndefined()
    observations.push(parsed)
    await expect(card).toContainText(endpoint ? 'OpenDecider Nano' : 'Simulated fixture')
    await expect(card).toContainText('Uncalibrated')
    await expect(card).toContainText('Reported by Codex: Unknown')
    await expect(pane).toContainText('Offline synthetic response')
    await expect(card.getByRole('button', { name: /Apply|Auto/ })).toHaveCount(0)
  }
  const dispatched = await readSyntheticTurns(electronApp)
  expect(dispatched).toHaveLength(3)
  for (const snapshot of observations) {
    const params = dispatched[1].params
    expect(snapshot.observations.at(-1)?.requested).toEqual(
      params.model && params.effort ? { model: params.model, effort: params.effort } : undefined
    )
  }
  expect(dispatched[0].params.input).toEqual(dispatched[1].params.input)
  expect(dispatched[0].params.model).toBe(dispatched[1].params.model)
  expect(dispatched[0].params.effort).toBe(dispatched[1].params.effort)
  writeFileSync(
    testInfo.outputPath('shadow-workflow-evidence.json'),
    JSON.stringify(
      {
        provider: endpoint ? 'real-nano' : 'simulated-fixture',
        codex: 'offline-fixture',
        capture: 'offscreen static snapshot of actual Native Chat DOM',
        offCompletionMs,
        shadowCompletionMs,
        visibleLatencyMs,
        dispatched,
        observations
      },
      null,
      2
    )
  )
  await paintShadowScenes(electronApp, testInfo, 'shadow', await captureShadowHtml(orcaPage))
  await card.getByRole('switch', { name: 'Enable OpenDecider shadow' }).dispatchEvent('click')
  await expect(card).toContainText('Off')
})
