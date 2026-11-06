import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Demo images for docs/features/ and the release notes. Run: npm run docs:images
export default defineConfig({
  ...base,
  testDir: 'tests/docs',
  testIgnore: undefined,
});
