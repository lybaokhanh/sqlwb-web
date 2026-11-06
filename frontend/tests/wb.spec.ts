import { expect, test, type Page } from '@playwright/test';

// Wb features: completion, Files dialog, profile options, uncommitted check (mock),
// and two browser tabs against a real backend (PW_BASE_URL only).
const REAL = !!process.env.PW_BASE_URL;
const APP = REAL ? '/' : '/?mock=1';

async function appLogin(page: Page, name = 'tester') {
  const form = page.getByRole('form', { name: 'Log in' });
  await expect(form).toBeVisible();
  await form.locator('input[name="appUser"]').fill(name);
  await form.locator('input[name="appPassword"]').fill('secret');
  await form.getByRole('button', { name: 'Log in' }).click();
  await expect(form).toBeHidden();
}

async function dbLogin(page: Page) {
  const dlg = page.getByRole('dialog');
  await expect(dlg).toBeVisible();
  const user = dlg.locator('input[name="username"]');
  if (await user.count()) await user.fill('scott');
  await dlg.locator('input[name="password"]').fill('tiger');
  await dlg.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(dlg).toBeHidden();
  await expect(page.locator('.tb-conn .conn-state.connected')).toBeVisible();
}

async function typeSql(page: Page, sql: string) {
  await expect(page.locator('.monaco-editor')).toBeVisible();
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.type(sql);
}

test.describe('mock', () => {
  test.skip(REAL, 'mock only');

  async function start(page: Page) {
    await page.goto(APP);
    await appLogin(page);
    await dbLogin(page);
  }

  test('Ctrl+Space: tables and columns from the server', async ({ page }) => {
    await start(page);
    const box = page.locator('.suggest-widget');
    await typeSql(page, 'select * from ');
    await page.keyboard.press('Control+Space');
    await expect(box).toContainText('DEPARTMENTS');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+A');
    await page.keyboard.type('select  from employees');
    for (let i = 0; i < 'from employees'.length + 1; i++) await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Control+Space');
    await expect(box).toContainText('EMPLOYEE_ID');
    await page.keyboard.press('Enter');
    await expect(page.locator('.monaco-editor .view-lines')).toContainText('select EMPLOYEE_ID from employees');
  });

  test('Files dialog: list, upload, delete', async ({ page }) => {
    await start(page);
    await page.getByRole('menuitem', { name: 'Tools', exact: true }).click();
    await page.getByRole('menuitem', { name: /Files/ }).click();
    const dlg = page.getByRole('dialog', { name: 'Files' });
    const list = dlg.getByTestId('files-list');
    await expect(list).toContainText('export/employees.csv');
    await dlg.getByTestId('files-upload').setInputFiles({ name: 'load.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n1,2\n') });
    await expect(list).toContainText('load.csv');
    await dlg.getByRole('button', { name: 'Delete load.csv' }).click();
    await expect(list).not.toContainText('load.csv');
  });

  test('profile: more options are saved and come back', async ({ page }) => {
    await start(page);
    await page.keyboard.press('Alt+C');
    const dlg = page.getByRole('dialog', { name: 'Select Connection Profile' });
    await dlg.locator('input[name="profileName"]').fill('OPTS');
    await dlg.locator('select[name="driver"]').selectOption('PostgreSQL');
    await expect(dlg.locator('input[name="url"]')).toHaveValue('jdbc:postgresql://host:5432/database');
    await dlg.getByTestId('cm-more').locator('summary').click();
    await dlg.locator('input[name="defaultSchema"]').fill('HR');
    await dlg.locator('textarea[name="connectScript"]').fill('WbVarDef x=1;');
    await dlg.locator('textarea[name="schemaFilter"]').fill('APEX_.*');
    await dlg.locator('input[name="ignoreDropErrors"]').check();
    await dlg.locator('input[name="checkUncommitted"]').check();
    await dlg.getByRole('button', { name: 'Save', exact: true }).click();
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    await page.reload();
    const again = page.getByRole('dialog');
    if (await again.isVisible()) await again.getByRole('button', { name: 'Cancel' }).click();
    await page.keyboard.press('Alt+C');
    await dlg.getByTestId('cm-list').getByRole('option', { name: /OPTS/ }).click();
    await dlg.getByTestId('cm-more').locator('summary').click();
    await expect(dlg.locator('input[name="defaultSchema"]')).toHaveValue('HR');
    await expect(dlg.locator('textarea[name="connectScript"]')).toHaveValue('WbVarDef x=1;');
    await expect(dlg.locator('textarea[name="schemaFilter"]')).toHaveValue('APEX_.*');
    await expect(dlg.locator('input[name="ignoreDropErrors"]')).toBeChecked();
    await expect(dlg.locator('input[name="checkUncommitted"]')).toBeChecked();
    await expect(dlg.locator('input[name="hideWarnings"]')).not.toBeChecked();
  });

  test('check uncommitted: closing a tab with open DML asks first', async ({ page }) => {
    await start(page);
    await page.keyboard.press('Alt+C');
    const cm = page.getByRole('dialog', { name: 'Select Connection Profile' });
    await cm.locator('input[name="profileName"]').fill('TX');
    await cm.locator('input[name="username"]').fill('scott');
    await cm.locator('input[name="password"]').fill('tiger');
    await cm.getByTestId('cm-more').locator('summary').click();
    await cm.locator('input[name="checkUncommitted"]').check();
    await cm.getByRole('button', { name: 'Connect in new tab' }).click();
    await expect(page.locator('.tb-conn .conn-state.connected')).toBeVisible();
    await typeSql(page, "update emp set sal = 1 where id = 7");
    await page.keyboard.press('Control+Enter');
    await expect(page.getByTestId('messages')).toContainText('rows affected');
    await page.getByRole('menuitem', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: /Close tab/i }).click();
    const ask = page.getByRole('dialog', { name: 'Uncommitted changes' });
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('tab', { name: /Statement 2/ })).toBeVisible();
  });
});

test.describe('real backend', () => {
  test.skip(!REAL, 'needs PW_BASE_URL (backend with H2)');

  test('two browser tabs: each gets its own results', async ({ browser }) => {
    const context = await browser.newContext();
    const user = `pw${Date.now().toString(36)}`;
    const db = `jdbc:h2:mem:${user};DB_CLOSE_DELAY=-1`;
    const a = await context.newPage();
    await a.goto(APP);
    await appLogin(a, user);
    // Default profile (Oracle) asks for a login: use an H2 profile instead
    const first = a.getByRole('dialog');
    if (await first.isVisible()) await first.getByRole('button', { name: 'Cancel' }).click();
    await a.keyboard.press('Alt+C');
    const cm = a.getByRole('dialog', { name: 'Select Connection Profile' });
    await cm.locator('select[name="driver"]').selectOption('H2');
    await cm.locator('input[name="url"]').fill(db);
    await cm.locator('input[name="profileName"]').fill('H2');
    await cm.locator('input[name="username"]').fill('sa');
    await cm.locator('input[name="password"]').fill('tiger');
    await cm.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(a.locator('.tb-conn .conn-state.connected')).toBeVisible();
    await typeSql(a, "select 'AAA' as w from dual");
    await a.waitForTimeout(1500); // workspace save

    const b = await context.newPage();
    await b.goto(APP);
    await expect(b.locator('.tb-conn .conn-state.connected')).toBeVisible();
    await b.locator('.monaco-editor .view-lines').click();
    await b.keyboard.press('Control+A');
    await b.keyboard.type("select 'BBB' as w from dual");

    await b.keyboard.press('Control+Enter');
    await a.bringToFront();
    const conflict = a.getByRole('dialog', { name: 'Workspace changed in another browser tab' });
    if (await conflict.isVisible()) await conflict.getByRole('button', { name: 'Keep this tab' }).click();
    await a.locator('.monaco-editor .view-lines').click();
    await a.keyboard.press('Control+Enter');
    await expect(a.locator('.grid-body')).toContainText('AAA');
    await expect(b.locator('.grid-body')).toContainText('BBB');
    await expect(a.locator('.grid-body')).not.toContainText('BBB');
    await expect(b.locator('.grid-body')).not.toContainText('AAA');
    await context.close();
  });
});
