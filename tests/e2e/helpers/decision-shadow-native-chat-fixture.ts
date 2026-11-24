import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import type { Page, ElectronApplication } from '@stablyai/playwright-test'
import { test as base, expect } from './orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './store'
import { createSeededTestRepo } from './seeded-test-repo'
import { structuredAgentSessionCreateParams } from '../../../src/shared/structured-agent-session-create'
import { decisionShadowReadResultSchema } from '../../../src/shared/decision-shadow-wire'

// This executable implements the app-server transport, never a frontier request.
const fakeCodex = `#!/usr/bin/env node
if (process.argv.includes('--version')) { console.log('codex-cli 0.0.0-e2e'); process.exit(0) }
const readline = require('node:readline'); const fs = require('node:fs'); let turn = 0;
const send = value => process.stdout.write(JSON.stringify(value)+'\\n');
readline.createInterface({input:process.stdin}).on('line', line => {
 let request; try { request=JSON.parse(line) } catch { return }
 if (request.id === undefined) return;
 const reply = result => send({id:request.id,result});
 if (request.method==='initialize') reply({});
 else if (request.method==='thread/start') reply({thread:{id:'thread-shadow',path:null},model:'gpt-6.1-sol',reasoningEffort:'medium'});
 else if (request.method==='model/list') reply({data:[{id:'gpt-6.1-sol',displayName:'GPT-6.1 Sol',isDefault:true,defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'medium'},{reasoningEffort:'high'}]}],nextCursor:null});
 else if (request.method==='config/read') reply({config:{model:'gpt-6.1-sol',model_reasoning_effort:'medium'}});
 else if (request.method==='thread/read') reply({thread:{id:'thread-shadow',historyMode:'paginated',status:{type:'idle'}}});
 else if (request.method==='turn/start') {
   fs.appendFileSync(process.env.ORCA_SHADOW_FIXTURE_LOG, JSON.stringify({...request,receivedAtNs:process.hrtime.bigint().toString()})+'\\n');
   const id='turn-'+(++turn), p=request.params;
   reply({turn:{id,status:'inProgress'}});
   setTimeout(()=>{
    send({method:'turn/started',params:{threadId:'thread-shadow',turn:{id,status:'inProgress'}}});
    send({method:'item/completed',params:{threadId:'thread-shadow',turnId:id,item:{type:'userMessage',id:'user-'+turn,clientId:p.clientUserMessageId,content:p.input}}});
    send({method:'item/completed',params:{threadId:'thread-shadow',turnId:id,item:{type:'agentMessage',id:'assistant-'+turn,text:'Offline synthetic response '+turn}}});
    send({method:'turn/completed',params:{threadId:'thread-shadow',turn:{id,status:'completed'}}});
   },20);
 } else reply({});
});
`
export const test = base.extend<{ shadowEndpoint: string | undefined }>({
  shadowEndpoint: [process.env.ORCA_DECISION_SHADOW_E2E_ENDPOINT, { option: true }],
  seededRepoPath: async ({ registerPostElectronShutdownCleanup }, provideFixture) => {
    const repo = createSeededTestRepo({ publishPath: false })
    const ownedPaths = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: repo,
      encoding: 'utf8'
    })
      .split('\n')
      .filter((line) => line.startsWith('worktree '))
      .map((line) => line.slice(9))
    registerPostElectronShutdownCleanup(async () => {
      for (const ownedPath of ownedPaths.toReversed()) {
        rmSync(ownedPath, { recursive: true, force: true })
      }
    })
    await provideFixture(repo)
  },
  launchEnv: async ({ registerPostElectronShutdownCleanup, shadowEndpoint }, provideFixture) => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'orca-shadow-codex-'))
    writeFileSync(path.join(directory, 'codex'), fakeCodex, { mode: 0o755 })
    registerPostElectronShutdownCleanup(async () => {
      rmSync(directory, { recursive: true, force: true })
    })
    await provideFixture({
      PATH: `${directory}${path.delimiter}${process.env.PATH ?? ''}`,
      ORCA_BACKGROUND_LAUNCH: '1',
      ORCA_SHADOW_FIXTURE_LOG: path.join(directory, 'turns.jsonl'),
      ...(shadowEndpoint
        ? { ORCA_DECISION_SHADOW_ENDPOINT: shadowEndpoint }
        : { ORCA_DECISION_SHADOW_PROVIDER: 'simulated-fixture' })
    })
  }
})

export async function openShadowChat(orcaPage: Page, electronApp: ElectronApplication) {
  await electronApp.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.setBackgroundThrottling(false)
    }
  })
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  const worktree = await orcaPage.evaluate(() => window.__store?.getState().activeWorktreeId)
  if (!worktree) {
    throw new Error('Missing seeded worktree')
  }
  const sessionId = `codex_${randomUUID().replaceAll('-', '_')}`
  const params = structuredAgentSessionCreateParams({
    sessionId,
    worktree,
    agent: 'codex',
    randomUuid: randomUUID
  })
  await orcaPage.evaluate(async (createParams) => {
    const settings = await window.api.settings.set({ experimentalStructuredNativeChat: true })
    window.__store?.setState({ settings })
    const response = await window.api.runtime.call({
      method: 'agentSession.create',
      params: createParams
    })
    if (!response.ok) {
      throw new Error(response.error.code)
    }
  }, params)
  // Hidden windows do not supply the animation frames that pointer stability checks await.
  // Dispatch through the rendered control without showing or focusing the native window.
  const tab = orcaPage.locator(`[data-tab-id="structured-agent-session-${sessionId}"]`)
  const pointer = {
    button: 0,
    clientX: 0,
    clientY: 0,
    pointerId: 1,
    isPrimary: true,
    pointerType: 'mouse'
  }
  await tab.dispatchEvent('pointerdown', pointer)
  await tab.dispatchEvent('pointerup', pointer)
  await expect(tab).toHaveAttribute('data-active', 'true')
  const pane = orcaPage.locator('[data-native-chat-root="true"]')
  const card = pane.getByRole('region', { name: 'OpenDecider shadow pilot' })
  await expect(card).toBeVisible()
  await expect(card).toContainText('Off')
  await expect
    .poll(async () =>
      orcaPage.evaluate(
        async ({ sessionId }) => {
          const response = await window.api.runtime.call({
            method: 'agentSession.modelCatalog',
            params: { agent: 'codex', sessionId }
          })
          if (!response.ok) {
            throw new Error(response.error.code)
          }
          const result = response.result
          return result && typeof result === 'object' && 'origin' in result
            ? result.origin
            : undefined
        },
        { sessionId }
      )
    )
    .toMatch(/^(live-session|probe)$/)
  return { pane, card, sessionId }
}
export async function readShadow(orcaPage: Page, sessionId: string) {
  return decisionShadowReadResultSchema.parse(
    await orcaPage.evaluate(async (id) => {
      const response = await window.api.runtime.call({
        method: 'agentSession.decisionShadowRead',
        params: { sessionId: id }
      })
      if (!response.ok) {
        throw new Error(response.error.code)
      }
      return response.result
    }, sessionId)
  )
}
export async function readSyntheticTurns(electronApp: ElectronApplication) {
  const logPath = await electronApp.evaluate(() => process.env.ORCA_SHADOW_FIXTURE_LOG)
  if (!logPath) {
    throw new Error('Missing owned synthetic turn log')
  }
  const schema = z.object({
    method: z.literal('turn/start'),
    params: z.record(z.string(), z.unknown()),
    receivedAtNs: z.string().regex(/^\d+$/)
  })
  return readFileSync(logPath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => schema.parse(JSON.parse(line)))
}
