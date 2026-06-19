// @ts-check
// Minimale Playwright-Konfiguration für Contentix.
// Contentix läuft lokal auf Port 3038 (user dirk, NICHT Docker).

const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false, // sequenziell, weil Contentix eine single-user Node-App ist
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3038',
    headless: true,
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
  },
});