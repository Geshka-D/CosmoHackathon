import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  outputDir: '../reports/evidence/browser-artifacts',
  use: {
    channel: process.env.KOSMOS_BROWSER_CHANNEL || 'chrome',
    baseURL: process.env.KOSMOS_BASE_URL || 'http://127.0.0.1:8000',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
