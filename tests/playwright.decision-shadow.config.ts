import { defineConfig } from '@stablyai/playwright-test'

// Build e2e mode explicitly. The normal global setup installs a dev CLI shim.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/decision-shadow*.spec.ts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  outputDir: '../test-results/decision-shadow',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'electron-headless', metadata: { orcaHeadful: false } }]
})
