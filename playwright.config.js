import { defineConfig } from '@playwright/test'

// Extension E2E: real Chrome, real built extension, fixture served at axiom.trade.
// Deliberately serial and single-worker — every test launches its own browser with a
// persistent profile, and they share the extension's storage.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: { viewport: { width: 1280, height: 800 } },
})
