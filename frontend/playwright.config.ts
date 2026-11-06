import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// Use an installed browser. Never download Playwright browsers.
// PW_CHANNEL overrides. Else Chrome if found, else Edge.
const chromePaths = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA ?? ''}/Google/Chrome/Application/chrome.exe`,
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const channel = process.env.PW_CHANNEL ?? (chromePaths.some((p) => existsSync(p)) ? 'chrome' : 'msedge');

// PW_BASE_URL lets the tests run against the container (e.g. http://localhost:8484).
const baseURL = process.env.PW_BASE_URL ?? 'http://localhost:4173';

export default defineConfig({
  testDir: 'tests',
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL,
    channel,
    headless: true,
    viewport: { width: 1400, height: 860 },
  },
  webServer: process.env.PW_BASE_URL
    ? undefined
    : {
        command: 'npm run preview -- --port 4173 --strictPort',
        url: 'http://localhost:4173',
        reuseExistingServer: false,
        timeout: 60_000,
      },
});
