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
// PW_PORT: port of the local preview server (default 4173).
const port = process.env.PW_PORT ?? '4173';
const baseURL = process.env.PW_BASE_URL ?? `http://localhost:${port}`;

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
        command: `npm run preview -- --port ${port} --strictPort`,
        url: `http://localhost:${port}`,
        reuseExistingServer: false,
        timeout: 60_000,
      },
});
