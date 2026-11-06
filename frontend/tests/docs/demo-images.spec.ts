import { expect, test, type Page } from '@playwright/test';

// Demo images for docs/features/*.md and the release notes.
// Run: npm run docs:images (uses playwright.docs.config.ts, mock server, light theme).
// One test = one image = one feature doc. A new feature adds a test here.
const APP = '/?mock=1';
const OUT = '../docs/images';

async function appLogin(page: Page) {
  const form = page.getByRole('form', { name: 'Log in' });
  await expect(form).toBeVisible();
  await form.locator('input[name="appUser"]').fill('demo');
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

async function start(page: Page) {
  await page.goto(APP);
  await appLogin(page);
  await dbLogin(page);
  await setTheme(page, 'light');
}

async function setTheme(page: Page, theme: 'light' | 'dark') {
  if ((await page.locator('html').getAttribute('data-theme')) !== theme) {
    await page.locator('[data-action="toggleTheme"]').click();
  }
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

async function typeSql(page: Page, sql: string) {
  await expect(page.locator('.monaco-editor')).toBeVisible();
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.type(sql);
}

async function run(page: Page, sql: string, rows: string) {
  await typeSql(page, sql);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('row-info')).toHaveText(rows);
}

async function menu(page: Page, title: string, item: string) {
  await page.locator('.menu-title', { hasText: new RegExp(`^${title}$`) }).click();
  await page.locator('.menu-item', { hasText: item }).first().click();
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(400); // animations and fonts settle
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

test('login', async ({ page }) => {
  await page.goto(APP);
  await expect(page.getByRole('form', { name: 'Log in' })).toBeVisible();
  await page.locator('input[name="appUser"]').fill('demo');
  await shot(page, 'login');
});

test('sql-editor', async ({ page }) => {
  await start(page);
  await typeSql(page, 'select 1;\nselect 2;\nselect * from customers where id < 200;');
  await page.keyboard.press('Control+Shift+E');
  await expect(page.getByRole('tab', { name: 'Statistics' })).toBeVisible();
  await page.getByRole('tab', { name: /^Result 3/ }).click();
  await shot(page, 'sql-editor');
});

test('large-results', async ({ page }) => {
  await start(page);
  await run(page, 'select 100000', '500 rows loaded, more on scroll');
  await page.getByTestId('fetch-all').click();
  await expect(page.getByTestId('row-info')).toHaveText('100000 rows', { timeout: 30_000 });
  await shot(page, 'large-results');
});

test('themes', async ({ page }) => {
  await start(page);
  await run(page, 'select * from customers where id < 200', '200 rows');
  await setTheme(page, 'dark');
  await shot(page, 'themes');
});

test('connection-manager', async ({ page }) => {
  await start(page);
  await page.keyboard.press('Alt+C');
  const dlg = page.getByRole('dialog', { name: 'Select Connection Profile' });
  await dlg.locator('input[name="profileName"]').fill('REPORTING');
  await dlg.locator('input[name="group"]').fill('team-dba');
  await dlg.locator('input[name="username"]').fill('scott');
  await dlg.locator('input[name="password"]').fill('tiger');
  await dlg.getByRole('button', { name: 'Test' }).click();
  await expect(dlg.getByTestId('cm-test-result')).toContainText('OK: Oracle');
  await dlg.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dlg.getByTestId('cm-list')).toContainText('team-dba');
  await shot(page, 'connection-manager');
});

test('tab-groups', async ({ page }) => {
  await start(page);
  await page.keyboard.press('Alt+C');
  const cm = page.getByRole('dialog', { name: 'Select Connection Profile' });
  await cm.locator('input[name="profileName"]').fill('REPORTING');
  await cm.locator('input[name="username"]').fill('scott');
  await cm.locator('input[name="password"]').fill('tiger');
  await cm.getByRole('button', { name: 'Connect in new tab' }).click();
  await expect(page.getByTestId('tab-group')).toHaveCount(2);
  await page.locator('[data-action="verticalTabs"]').click();
  await expect(page.getByTestId('tabbar')).toHaveAttribute('aria-orientation', 'vertical');
  await shot(page, 'tab-groups');
});

test('db-explorer', async ({ page }) => {
  await start(page);
  await page.locator('[data-action="dbExplorer"]').click();
  const ex = page.getByTestId('explorer');
  const emp = ex.getByRole('option', { name: /^EMP\s*TABLE/ });
  await emp.click();
  await expect(ex.locator('.meta-table')).toContainText('NAME_1');
  await shot(page, 'db-explorer');
});

test('editable-grid', async ({ page }) => {
  await start(page);
  await run(page, 'select * from emp', '50 rows');
  await page.locator('.grid-row').nth(0).locator('.cell').nth(2).dblclick();
  await page.locator('.cell-input').fill('Changed');
  await page.keyboard.press('Enter');
  await page.locator('.grid-row').nth(1).locator('.cell').nth(3).click();
  await page.locator('[data-action="deleteRow"]').click();
  await page.locator('[data-action="saveChanges"]').click();
  await expect(page.getByTestId('confirm-sql')).toContainText('DELETE FROM emp');
  await shot(page, 'editable-grid');
});

test('export', async ({ page }) => {
  await start(page);
  await run(page, 'select * from dept where rownum <= 3', '3 rows');
  await menu(page, 'Data', 'Save data as');
  await expect(page.getByRole('dialog')).toBeVisible();
  await shot(page, 'export');
});

test('macros-and-bookmarks', async ({ page }) => {
  await start(page);
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.press('Control+m');
  const dlg = page.getByRole('dialog', { name: 'Manage macros' });
  await dlg.locator('input[name="macroName"]').fill('fortytwo');
  await dlg.locator('textarea[name="macroSql"]').fill('select 42');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(dlg.getByRole('option', { name: /fortytwo/ })).toBeVisible();
  await shot(page, 'macros-and-bookmarks');
});

test('safe-execution', async ({ page }) => {
  await start(page);
  await page.keyboard.press('Alt+C');
  const cm = page.getByRole('dialog');
  await cm.locator('input[name="username"]').fill('scott');
  await cm.locator('input[name="password"]').fill('tiger');
  await cm.locator('input[name="confirmNoWhere"]').check();
  await cm.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(cm).toBeHidden();
  await typeSql(page, 'delete from t');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('dialog')).toContainText('changes all rows');
  await shot(page, 'safe-execution');
});

test('load-run', async ({ page }) => {
  await start(page);
  await typeSql(page, 'select 1');
  await menu(page, 'Tools', 'Load run');
  const panel = page.getByTestId('load-panel');
  await panel.locator('input[name="seconds"]').fill('2');
  await panel.getByRole('button', { name: 'Start' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start load run' }).click();
  await expect(page.getByTestId('load-stats')).toContainText('finished', { timeout: 10_000 });
  await shot(page, 'load-run');
});

test('workspace', async ({ page }) => {
  await start(page);
  await typeSql(page, 'select * from emp');
  await page.getByRole('button', { name: 'Add tab' }).click();
  await page.waitForTimeout(1500); // debounced save
  await page.reload();
  await expect(page.getByRole('dialog')).toContainText('Reconnect');
  await shot(page, 'workspace');
});

test('engine-update', async ({ page }) => {
  await start(page);
  await page.getByTestId('update-btn').click();
  await expect(page.getByRole('dialog')).toContainText('All users get disconnected');
  await shot(page, 'engine-update');
});

test('result-sort', async ({ page }) => {
  await start(page);
  await run(page, 'select 30 from emp', '30 rows');
  const head = page.getByTestId('head-0');
  await head.click();
  await head.click();
  await expect(head).toHaveAttribute('aria-sort', 'descending');
  await shot(page, 'result-sort');
});

test('auto-completion', async ({ page }) => {
  await start(page);
  await typeSql(page, 'select * from ');
  await expect(page.locator('.suggest-widget')).toContainText('DEPARTMENTS');
  await shot(page, 'auto-completion');
});

test('cell-dialog', async ({ page }) => {
  await start(page);
  await run(page, 'select 5 from emp where json = 1', '5 rows');
  await page.locator('.grid-row').first().locator('.cell').last().dblclick();
  const dlg = page.getByTestId('cell-dialog');
  await expect(dlg.locator('.view-line', { hasText: '"owner": {' })).toBeVisible();
  await shot(page, 'cell-dialog');
});
