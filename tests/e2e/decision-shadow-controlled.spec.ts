import { writeFileSync } from 'node:fs'
import { expect } from './helpers/orca-app'
import { test } from './helpers/decision-shadow-http-fixture'
import {
  openShadowChat,
  readShadow,
  readSyntheticTurns
} from './helpers/decision-shadow-native-chat-fixture'
import { captureShadowHtml, paintShadowScenes } from './helpers/decision-shadow-scene-capture'

const task = 'Implement a bounded CSV parser with validation and tests.'

test('controlled HTTP pending, unavailable and abstention scenes preserve Codex execution', async ({
  orcaPage,
  electronApp,
  controlledHttp
}, testInfo) => {
  test.setTimeout(180_000)
  test.skip(process.platform === 'win32', 'POSIX offline app-server fixture')
  const { pane, card, sessionId } = await openShadowChat(orcaPage, electronApp)
  await card.getByRole('switch', { name: 'Enable OpenDecider shadow' }).dispatchEvent('click')
  await expect(card).toContainText('Shadow')
  const evidence: unknown[] = []
  let count = 0
  for (const scenario of ['gated', 'unavailable', 'abstain'] as const) {
    controlledHttp.setScenario(scenario)
    await pane.getByRole('textbox', { name: 'Send a message…' }).fill(task)
    await pane.getByRole('textbox', { name: 'Send a message…' }).press('Enter')
    await expect(
      pane.getByText(`Offline synthetic response ${++count}`, { exact: true })
    ).toBeVisible()
    const state =
      scenario === 'gated'
        ? 'pending'
        : scenario === 'unavailable'
          ? 'unavailable'
          : 'needs_context'
    await expect
      .poll(async () => (await readShadow(orcaPage, sessionId)).observations.at(-1)?.state, {
        intervals: [50]
      })
      .toBe(state)
    await expect(card.getByText(new RegExp(`^${state}(?: ·|$)`))).toBeVisible()
    const assertState = async () => {
      expect((await readShadow(orcaPage, sessionId)).observations.at(-1)?.state).toBe(state)
      await expect(card.getByText(new RegExp(`^${state}(?: ·|$)`))).toBeVisible()
    }
    const snapshot = await readShadow(orcaPage, sessionId)
    const scenes = await captureShadowHtml(orcaPage, assertState)
    if (scenario === 'gated') {
      expect(controlledHttp.gates).toHaveLength(1)
      expect(controlledHttp.gates[0].released).toBe(false)
      evidence.push({ state, snapshot, syntheticCompletedWhileHttpUnresolved: true })
      controlledHttp.gates[0].release()
      await expect
        .poll(async () => (await readShadow(orcaPage, sessionId)).observations.at(-1)?.state, {
          intervals: [50]
        })
        .toBe('available')
    } else {
      evidence.push({ state, snapshot })
    }
    await paintShadowScenes(electronApp, testInfo, state, scenes)
  }
  const turns = await readSyntheticTurns(electronApp)
  expect(turns).toHaveLength(3)
  for (const turn of turns.slice(1)) {
    expect(turn.params.input).toEqual(turns[0].params.input)
    expect(turn.params.model).toBe(turns[0].params.model)
    expect(turn.params.effort).toBe(turns[0].params.effort)
  }
  await card.getByRole('switch', { name: 'Enable OpenDecider shadow' }).dispatchEvent('click')
  await expect(card).toContainText('Off')
  writeFileSync(
    testInfo.outputPath('controlled-scenes.json'),
    JSON.stringify(
      {
        provider: 'controlled-http-fixture-not-real-inference',
        codex: 'offline-fixture',
        capture: 'offscreen snapshots of actual DOM and CSS; not physical pointer proof',
        evidence,
        turns
      },
      null,
      2
    )
  )
})

test('balanced warm Off/Shadow samples preserve transport while HTTP decision remains unresolved', async ({
  orcaPage,
  electronApp,
  controlledHttp
}, testInfo) => {
  test.setTimeout(180_000)
  test.skip(process.platform === 'win32', 'POSIX offline app-server fixture')
  test.skip(
    process.platform !== 'linux',
    'Cross-process clock evidence is verified only on same-host Linux'
  )
  const { pane, card, sessionId } = await openShadowChat(orcaPage, electronApp)
  let mode = 'off'
  let count = 0
  const trials: {
    mode: string
    pair: number
    submitToTransportMs: number
    submitToSyntheticCompletionMs: number
    decisionHeldUntilCompletion: boolean
  }[] = []
  for (let pair = -2; pair < 8; pair++) {
    const order = pair % 2 === 0 ? ['off', 'shadow'] : ['shadow', 'off']
    for (const next of order) {
      if (mode !== next) {
        await card.getByRole('switch', { name: 'Enable OpenDecider shadow' }).dispatchEvent('click')
        await expect
          .poll(async () => (await readShadow(orcaPage, sessionId)).mode, { intervals: [50] })
          .toBe(next)
        mode = next
      }
      const gatesBefore = controlledHttp.gates.length
      await pane.getByRole('textbox', { name: 'Send a message…' }).fill(task)
      const started = process.hrtime.bigint()
      await pane.getByRole('textbox', { name: 'Send a message…' }).press('Enter')
      await expect(
        pane.getByText(`Offline synthetic response ${++count}`, { exact: true })
      ).toBeVisible()
      const completed = process.hrtime.bigint()
      const turns = await readSyntheticTurns(electronApp)
      const turn = turns.at(-1)
      if (!turn) {
        throw new Error('Missing actual synthetic turn')
      }
      expect(turns).toHaveLength(count)
      const received = BigInt(turn.receivedAtNs)
      expect(started <= received && received <= completed).toBe(true)
      expect(turn.params.input).toEqual(turns[0].params.input)
      // Compare all options; only per-message correlation IDs may change.
      const { clientUserMessageId: _firstId, input: _firstInput, ...firstOptions } = turns[0].params
      const { clientUserMessageId: _id, input: _input, ...options } = turn.params
      expect(options).toEqual(firstOptions)
      if (next === 'shadow') {
        await expect
          .poll(() => controlledHttp.gates.length, { intervals: [25] })
          .toBe(gatesBefore + 1)
        const gate = controlledHttp.gates.at(-1)
        if (!gate) {
          throw new Error('Missing controlled HTTP gate')
        }
        expect(gate.released).toBe(false)
        expect(BigInt(gate.receivedAtNs) <= completed).toBe(true)
        expect((await readShadow(orcaPage, sessionId)).observations.at(-1)?.state).toBe('pending')
        gate.release()
        await expect
          .poll(async () => (await readShadow(orcaPage, sessionId)).observations.at(-1)?.state, {
            intervals: [25]
          })
          .toBe('available')
      } else {
        expect(controlledHttp.gates).toHaveLength(gatesBefore)
      }
      trials.push({
        mode: next,
        pair,
        submitToTransportMs: Number(received - started) / 1e6,
        submitToSyntheticCompletionMs: Number(completed - started) / 1e6,
        decisionHeldUntilCompletion: next === 'shadow'
      })
    }
  }
  if (mode !== 'off') {
    await card.getByRole('switch', { name: 'Enable OpenDecider shadow' }).dispatchEvent('click')
  }
  await expect(card).toContainText('Off')
  const measured = trials.filter((trial) => trial.pair >= 0)
  const pairedDifferences = Array.from({ length: 8 }, (_, pair) => {
    const off = measured.find((trial) => trial.pair === pair && trial.mode === 'off')
    const shadow = measured.find((trial) => trial.pair === pair && trial.mode === 'shadow')
    if (!off || !shadow) {
      throw new Error('Missing balanced measured pair')
    }
    return {
      pair,
      transportDeltaMs: shadow.submitToTransportMs - off.submitToTransportMs,
      syntheticCompletionDeltaMs:
        shadow.submitToSyntheticCompletionMs - off.submitToSyntheticCompletionMs
    }
  })
  const summaries = Object.fromEntries(
    ['off', 'shadow'].map((sampleMode) => {
      const samples = measured.filter((trial) => trial.mode === sampleMode)
      const metric = (key: 'submitToTransportMs' | 'submitToSyntheticCompletionMs') => {
        const values = samples.map((sample) => sample[key]).toSorted((a, b) => a - b)
        return { p50: (values[3] + values[4]) / 2, p95NearestRank: values.at(-1) }
      }
      return [
        sampleMode,
        {
          n: samples.length,
          transport: metric('submitToTransportMs'),
          syntheticCompletion: metric('submitToSyntheticCompletionMs')
        }
      ]
    })
  )
  writeFileSync(
    testInfo.outputPath('balanced-overhead.json'),
    JSON.stringify(
      {
        provider: 'controlled-http-fixture-not-real-inference',
        codex: 'offline-fixture',
        clock:
          'same-host Linux/libuv CLOCK_MONOTONIC via process.hrtime.bigint; not a cross-platform Node API guarantee',
        platform: process.platform,
        runnerNodeVersion: process.version,
        interpretation:
          '8 balanced pairs after 2 warmup pairs; harness/transport timings, not frontier latency, allowance savings or production overhead guarantee',
        trials,
        pairedDifferences,
        summaries,
        turns: await readSyntheticTurns(electronApp)
      },
      null,
      2
    )
  )
})
