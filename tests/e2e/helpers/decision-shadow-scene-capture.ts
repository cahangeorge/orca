import { writeFileSync } from 'node:fs'
import type { Page, ElectronApplication, TestInfo } from '@stablyai/playwright-test'
import { expect } from './orca-app'

export async function captureShadowHtml(orcaPage: Page, assertState?: () => Promise<void>) {
  const scenes: { theme: string; html: string }[] = []
  for (const theme of ['light', 'dark']) {
    await assertState?.()
    await orcaPage.evaluate(
      (mode) => document.documentElement.classList.toggle('dark', mode === 'dark'),
      theme
    )
    const html = await orcaPage.evaluate(() => {
      const clone = document.documentElement.cloneNode(true)
      if (!(clone instanceof HTMLElement)) {
        throw new Error('Invalid document clone')
      }
      for (const script of clone.querySelectorAll('script')) {
        script.remove()
      }
      // A data URL cannot load the original file:// stylesheets. Inline the CSS
      // actually applied to this pane so the hidden snapshot preserves layout/theme.
      const styles = document.createElement('style')
      styles.textContent = Array.from(document.styleSheets)
        .flatMap((sheet) => Array.from(sheet.cssRules).map((rule) => rule.cssText))
        .join('\n')
      if (!styles.textContent) {
        throw new Error('Missing actual pane styles')
      }
      for (const link of clone.querySelectorAll('link[rel="stylesheet"], style')) {
        link.remove()
      }
      clone.querySelector('head')?.append(styles)
      return `<!doctype html>${clone.outerHTML}`
    })
    scenes.push({ theme, html })
    await assertState?.()
  }
  return scenes
}
export async function paintShadowScenes(
  electronApp: ElectronApplication,
  testInfo: TestInfo,
  prefix: string,
  scenes: { theme: string; html: string }[]
) {
  const windowStates = await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => ({
      visible: window.isVisible(),
      focused: window.isFocused()
    }))
  )
  expect(windowStates.every((state) => !state.visible && !state.focused)).toBe(true)
  for (const { theme, html } of scenes) {
    const png = await electronApp.evaluate(async ({ BrowserWindow }, html) => {
      const original = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
      if (!original) {
        throw new Error('No hidden source window')
      }
      const { width, height } = original.getContentBounds()
      const snapshot = new BrowserWindow({
        show: false,
        width,
        height,
        webPreferences: { offscreen: true, javascript: false, backgroundThrottling: false }
      })
      try {
        await snapshot.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
        const image = await snapshot.webContents.capturePage(undefined, { stayHidden: true })
        if (image.isEmpty()) {
          throw new Error('Empty offscreen capture')
        }
        return image.toPNG().toString('base64')
      } finally {
        snapshot.destroy()
      }
    }, html)
    writeFileSync(testInfo.outputPath(`${prefix}-${theme}.png`), Buffer.from(png, 'base64'))
  }
}
