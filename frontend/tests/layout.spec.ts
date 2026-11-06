import { expect, test, type Page } from '@playwright/test';

// All tests use the in-memory mock server (no backend needed).
const APP = '/?mock=1';

/** App login screen (mock: every login works). */
async function appLogin(page: Page) {
  const form = page.getByRole('form', { name: 'Log in' });
  await expect(form).toBeVisible();
  await form.locator('input[name="appUser"]').fill('tester');
  await form.locator('input[name="appPassword"]').fill('secret');
  await form.getByRole('button', { name: 'Log in' }).click();
  await expect(form).toBeHidden();
}

/** Database login dialog for the active tab. */
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
}

async function typeSql(page: Page, sql: string) {
  await expect(page.locator('.monaco-editor')).toBeVisible();
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.type(sql);
}

test('login screen says that a new name creates the account', async ({ page }) => {
  await page.goto(APP);
  await expect(page.getByText('First login with a new name creates the account.')).toBeVisible();
  await appLogin(page);
  await expect(page.locator('.app-user')).toHaveText('tester');
});

test('menu bar has the 9 menus', async ({ page }) => {
  await start(page);
  await expect(page.locator('.menu-title')).toHaveText([
    'File', 'Edit', 'View', 'Data', 'SQL', 'Macros', 'Workspace', 'Tools', 'Help',
  ]);
});

test('SQL menu shows Execute Current with Ctrl+Enter', async ({ page }) => {
  await start(page);
  await page.locator('.menu-title', { hasText: 'SQL' }).click();
  const item = page.locator('.menu-item', { hasText: 'Execute Current' });
  await expect(item).toBeVisible();
  await expect(item.locator('.menu-key')).toHaveText('Ctrl+Enter');
  await page.keyboard.press('Escape');
  await expect(item).toBeHidden();
});

test('Add tab makes Statement 2', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Add tab' }).click();
  await expect(page.getByRole('tab', { name: /Statement 2/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Statement 2/ })).toHaveAttribute('aria-selected', 'true');
});

test('theme toggle switches data-theme and survives reload', async ({ page }) => {
  await start(page);
  const html = page.locator('html');
  const before = await html.getAttribute('data-theme');
  expect(before === 'dark' || before === 'light').toBeTruthy();
  const after = before === 'dark' ? 'light' : 'dark';
  await page.locator('[data-action="toggleTheme"]').click();
  await expect(html).toHaveAttribute('data-theme', after);
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', after);
  await expect(page.locator('.menu-title').first()).toBeVisible();
  await expect(html).toHaveAttribute('data-theme', after);
});

test('select 100000: first page only, more on scroll, Fetch all, virtual grid', async ({ page }) => {
  await start(page);
  await typeSql(page, 'select 100000');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('tab', { name: /Result 1/ })).toBeVisible();
  const info = page.getByTestId('row-info');
  await expect(info).toHaveText('500 rows loaded, more on scroll');
  await page.waitForTimeout(500);
  await expect(info).toHaveText('500 rows loaded, more on scroll'); // no fetch without scroll
  await page.getByTestId('grid').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(info).toHaveText('5500 rows loaded, more on scroll');
  await page.getByTestId('fetch-all').click();
  await expect(info).toHaveText('100000 rows', { timeout: 30_000 });
  await expect(page.getByTestId('fetch-all')).toHaveCount(0);
  const domRows = await page.locator('.grid-row').count();
  expect(domRows).toBeGreaterThan(0);
  expect(domRows).toBeLessThan(200);
  await page.getByTestId('grid').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(page.locator('.grid-row .cell.rownum', { hasText: /^100000$/ })).toBeVisible();
  expect(await page.locator('.grid-row').count()).toBeLessThan(200);
});

test('status bar shows the cursor position', async ({ page }) => {
  await start(page);
  await expect(page.getByTestId('statusbar')).toContainText(/L:1 C:\d+/);
});

test('Statistics tab after Execute All', async ({ page }) => {
  await start(page);
  await typeSql(page, 'select 1;\nselect 2;\nselect 1;\nupdate t set a = 1;');
  await page.keyboard.press('Control+Shift+E');
  const statsTab = page.getByRole('tab', { name: 'Statistics' });
  await expect(statsTab).toBeVisible();
  await statsTab.click();
  const stats = page.getByTestId('stats');
  await expect(stats).toContainText('4 statements, 3 distinct');
  await expect(stats.getByRole('button', { name: 'Export CSV' })).toBeVisible();
  const download = page.waitForEvent('download');
  await stats.getByRole('button', { name: 'Export CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.csv$/);
});

test('Max. results caps the result tabs', async ({ page }) => {
  await start(page);
  await page.locator('#max-results').fill('2');
  await typeSql(page, 'select 1;\nselect 2;\nselect 3;');
  await page.keyboard.press('Control+Shift+E');
  await expect(page.getByRole('tab', { name: 'Statistics' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /^Result \d/ })).toHaveCount(2);
  await expect(page.getByRole('tab', { name: /^Result 3/ })).toBeVisible();
});

test('workspace comes back after reload and asks only for the password', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Add tab' }).click();
  await expect(page.getByRole('tab', { name: /Statement 2/ })).toBeVisible();
  await page.waitForTimeout(1500); // debounce 1 s
  await page.reload();
  await expect(page.getByRole('tab', { name: /Statement 2/ })).toBeVisible();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText('Reconnect');
  await expect(dlg.locator('input[name="username"]')).toHaveCount(0);
  await expect(dlg.locator('input[name="password"]')).toBeVisible();
});

test('admin sees the update button and can start the update', async ({ page }) => {
  await start(page);
  const btn = page.getByTestId('update-btn');
  await expect(btn).toHaveText('Update to Build 133');
  await btn.click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText('All users get disconnected');
  const reloaded = page.waitForEvent('load');
  await dlg.getByRole('button', { name: 'Update and restart' }).click();
  await expect(page.getByTestId('restarting')).toBeVisible();
  await reloaded;
});

async function menu(page: Page, title: string, item: string) {
  await page.locator('.menu-title', { hasText: new RegExp(`^${title}$`) }).click();
  await page.locator('.menu-item', { hasText: item }).first().click();
}

test('DB Explorer: objects, columns, source, data, put SELECT in editor', async ({ page }) => {
  await start(page);
  await page.locator('[data-action="dbExplorer"]').click();
  await expect(page.getByRole('tab', { name: /DB Explorer/ })).toBeVisible();
  const ex = page.getByTestId('explorer');
  const emp = ex.getByRole('option', { name: /^EMP\s*TABLE/ });
  await expect(emp).toBeVisible();
  await emp.click();
  await expect(ex.locator('.meta-table')).toContainText('NAME_1');
  await ex.getByRole('tab', { name: 'Indexes' }).click();
  await expect(ex.locator('.meta-table')).toContainText('PK_EMP');
  await ex.getByRole('tab', { name: 'Source' }).click();
  await expect(ex.getByTestId('source')).toContainText('CREATE');
  await ex.getByRole('tab', { name: 'Data', exact: true }).click();
  await expect(ex.locator('.grid-row').first()).toBeVisible();
  await emp.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Put SELECT in editor' }).click();
  await expect(page.getByRole('tab', { name: /Statement 1/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('SCOTT.EMP');
});

test('DB Explorer: Objects type filter, Procedures, Triggers, Search table data', async ({ page }) => {
  await start(page);
  await page.locator('[data-action="dbExplorer"]').click();
  const ex = page.getByTestId('explorer');
  const list = ex.getByRole('listbox', { name: 'Objects' });
  await expect(list.getByRole('option', { name: /^EMP_SEQ\s*SEQUENCE/ })).toBeVisible();
  await expect(list.getByRole('option', { name: /RAISE_SALARY/ })).toHaveCount(0);
  await ex.getByLabel('Object types').selectOption('VIEW');
  await expect(list.getByRole('option')).toHaveCount(1);

  await ex.getByRole('tab', { name: 'Procedures' }).click();
  await expect(list.getByRole('option')).toHaveCount(3);
  await list.getByRole('option', { name: /^GET_SALARY/ }).click();
  await expect(ex.getByTestId('source')).toContainText('FUNCTION');
  await ex.getByRole('tab', { name: 'Parameters' }).click();
  await expect(ex.locator('.meta-table')).toContainText('P_EMP_ID');

  await ex.getByRole('tab', { name: 'Triggers' }).click();
  await list.getByRole('option', { name: /^EMP_BIU\s*EMP/ }).click();
  await expect(ex.locator('.rinfo')).toContainText('on EMP, BEFORE EACH ROW INSERT OR UPDATE');

  await ex.getByRole('tab', { name: 'Search table data' }).click();
  await expect(list.getByRole('option')).toHaveCount(5);
  await ex.getByLabel('Search value').fill('smith');
  await ex.getByRole('button', { name: 'Search 5 tables' }).click();
  await expect(ex.getByTestId('search-progress')).toContainText('Done: 5 tables searched. 2 tables with hits.');
  await expect(ex.getByTestId('search-hits')).toContainText('SCOTT.EMP: 3 rows');
  await expect(ex.getByTestId('search-hits')).toContainText('SMITH 1');
  await expect(list.getByRole('option', { name: /^EMP\s*3 rows/ })).toBeVisible();
});

test('editable grid: change, delete, confirm and save', async ({ page }) => {
  await start(page);
  await typeSql(page, 'select * from emp');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('row-info')).toHaveText('50 rows');
  const row1 = page.locator('.grid-row').nth(0);
  await row1.locator('.cell').nth(2).dblclick();
  await page.locator('.cell-input').fill('Changed');
  await page.keyboard.press('Enter');
  await expect(page.locator('.cell.changed')).toHaveText('Changed');
  await page.locator('.grid-row').nth(1).locator('.cell').nth(3).click();
  await page.locator('[data-action="deleteRow"]').click();
  await expect(page.locator('.grid-row.deleted')).toHaveCount(1);
  await page.locator('[data-action="insertRow"]').click();
  await expect(page.locator('.grid-row.inserted')).toHaveCount(1);
  await page.locator('[data-action="saveChanges"]').click();
  const sql = page.getByTestId('confirm-sql');
  await expect(sql).toContainText("UPDATE emp SET NAME_1 = 'Changed' WHERE ID = 1;");
  await expect(sql).toContainText('DELETE FROM emp WHERE ID = 2;');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.cell.changed')).toHaveCount(0);
  await expect(page.locator('.grid-row.deleted')).toHaveCount(0);
  await expect(page.getByTestId('row-info')).toHaveText('50 rows');
});

test('editable grid: table without PK asks for key columns', async ({ page }) => {
  await start(page);
  await typeSql(page, 'select * from bonus');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('row-info')).toHaveText('50 rows');
  await page.locator('.grid-row').nth(0).locator('.cell').nth(2).dblclick();
  await page.locator('.cell-input').fill('X');
  await page.keyboard.press('Enter');
  await page.locator('[data-action="saveChanges"]').click();
  const dlg = page.getByRole('dialog', { name: 'Define Key Columns' });
  await expect(dlg).toBeVisible();
  await dlg.getByLabel(/^ID/).check();
  await dlg.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('confirm-sql')).toContainText("UPDATE bonus SET NAME_1 = 'X' WHERE ID = 1;");
});

test('load run with warning for the default database', async ({ page }) => {
  await start(page);
  await typeSql(page, 'select 1');
  await menu(page, 'Tools', 'Load run');
  const panel = page.getByTestId('load-panel');
  await expect(panel.getByRole('alert')).toContainText('WARNING');
  await panel.locator('input[name="seconds"]').fill('2');
  await panel.getByRole('button', { name: 'Start' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start load run' }).click();
  await expect(page.getByTestId('load-stats')).toContainText('finished', { timeout: 10_000 });
  await expect(panel.locator('svg.load-chart')).toBeVisible();
});

test('export: save as TSV and copy as SQL INSERT', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await start(page);
  await typeSql(page, 'select * from dept where rownum <= 3');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('row-info')).toHaveText('3 rows');
  await menu(page, 'Data', 'Save data as');
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Text (tab)').check();
  const download = page.waitForEvent('download');
  await dlg.getByRole('button', { name: 'Save' }).click();
  expect((await download).suggestedFilename()).toBe('dept.tsv');
  await menu(page, 'Data', 'Copy as SQL INSERT');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('INSERT INTO dept (ID, NAME_1');
});

test('macros: create with Ctrl+M, run from the Macros menu', async ({ page }) => {
  await start(page);
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.press('Control+m');
  const dlg = page.getByRole('dialog', { name: 'Manage macros' });
  await expect(dlg).toBeVisible();
  await dlg.locator('input[name="macroName"]').fill('fortytwo');
  await dlg.locator('textarea[name="macroSql"]').fill('select 42');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(dlg.getByRole('option', { name: /fortytwo/ })).toBeVisible();
  await dlg.getByRole('button', { name: 'Close' }).click();
  await menu(page, 'Macros', 'fortytwo');
  await expect(page.getByTestId('row-info')).toHaveText('42 rows');
});

test('bookmarks list @WbTag lines', async ({ page }) => {
  await start(page);
  await typeSql(page, '-- @WbTag first\nselect 1;');
  await menu(page, 'Tools', 'Bookmarks');
  const dlg = page.getByRole('dialog', { name: 'Bookmarks' });
  await expect(dlg.getByRole('option', { name: /first/ })).toBeVisible();
  await dlg.getByRole('option', { name: /first/ }).click();
  await expect(dlg).toBeHidden();
});
test('screenshots dark and light', async ({ page }) => {
  await start(page);
  await typeSql(page, 'select * from customers where id < 200');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('row-info')).toHaveText('200 rows');
  for (const theme of ['dark', 'light'] as const) {
    if ((await page.locator('html').getAttribute('data-theme')) !== theme) {
      await page.locator('[data-action="toggleTheme"]').click();
    }
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `tests/screenshots/${theme}.png` });
  }
});

/** Opens a new tab from the Connect window with the given profile flags. */
async function connectWith(page: Page, flags: ('readOnly' | 'confirmUpdates' | 'sysdba' | 'confirmNoWhere')[]) {
  await page.keyboard.press('Alt+C');
  const dlg = page.getByRole('dialog');
  await dlg.locator('input[name="username"]').fill('scott');
  await dlg.locator('input[name="password"]').fill('tiger');
  for (const f of flags) await dlg.locator(`input[name="${f}"]`).check();
  await dlg.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(dlg).toBeHidden();
  await expect(page.locator('.tb-conn .conn-state.connected')).toBeVisible();
}

test('read-only profile blocks DML and DDL, SELECT still runs', async ({ page }) => {
  await start(page);
  await connectWith(page, ['readOnly']);
  await typeSql(page, 'update t set a = 1');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('messages')).toContainText('is read-only: UPDATE is not allowed');
  await expect(page.getByTestId('messages')).not.toContainText('rows affected');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('select * from emp');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('row-info')).toHaveText('50 rows');
});

test('confirm updates: Cancel stops the run, Execute runs it', async ({ page }) => {
  await start(page);
  await connectWith(page, ['confirmUpdates']);
  await typeSql(page, 'update t set a = 1');
  await page.keyboard.press('Control+Enter');
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText('1 DML statement');
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByTestId('messages')).not.toContainText('rows affected');
  await page.keyboard.press('Control+Enter');
  await dlg.getByRole('button', { name: 'Execute' }).click();
  await expect(page.getByTestId('messages')).toContainText('rows affected');
});

test('confirm DML without WHERE asks, UPDATE with WHERE runs at once', async ({ page }) => {
  await start(page);
  await connectWith(page, ['confirmNoWhere']);
  await typeSql(page, 'delete from t');
  await page.keyboard.press('Control+Enter');
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText('changes all rows');
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('messages')).not.toContainText('rows affected');
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('update t set a = 1 where id = 2');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('messages')).toContainText('rows affected');
});

test('connection manager: group, test, save, filter; reload connects without a password prompt', async ({ page }) => {
  await start(page);
  await page.keyboard.press('Alt+C');
  const dlg = page.getByRole('dialog', { name: 'Select Connection Profile' });
  await dlg.locator('input[name="profileName"]').fill('BSD_02');
  await dlg.locator('input[name="group"]').fill('team-dba');
  await dlg.locator('input[name="username"]').fill('bsd_02');
  await dlg.locator('input[name="password"]').fill('wrong');
  await dlg.getByRole('button', { name: 'Test' }).click();
  await expect(dlg.getByTestId('cm-test-result')).toContainText('Failed: ORA-01017');
  await dlg.locator('input[name="password"]').fill('tiger');
  await dlg.getByRole('button', { name: 'Test' }).click();
  await expect(dlg.getByTestId('cm-test-result')).toContainText('OK: Oracle');
  await expect(dlg.locator('input[name="savePassword"]')).toBeChecked();
  await dlg.getByRole('button', { name: 'Save', exact: true }).click();
  const list = dlg.getByTestId('cm-list');
  await expect(list).toContainText('team-dba');
  await expect(list.getByRole('option', { name: /BSD_02/ })).toBeVisible();
  await dlg.getByRole('button', { name: 'New', exact: true }).click();
  await dlg.locator('input[name="profileName"]').fill('FA_11');
  await dlg.getByRole('button', { name: 'Save', exact: true }).click();
  await dlg.getByLabel('Filter profiles').fill('bsd');
  await expect(list.getByRole('option')).toHaveCount(1);
  await list.getByRole('option', { name: /BSD_02/ }).click();
  await dlg.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(dlg).toBeHidden();
  await expect(page.locator('.tb-conn .conn-state.connected')).toBeVisible();
  await page.waitForTimeout(1500); // debounced workspace save
  await page.reload();
  await expect(page.locator('.tb-conn .conn-state.connected')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('connection manager: import WbProfiles.xml from the desktop app', async ({ page }) => {
  await start(page);
  await page.keyboard.press('Alt+C');
  const dlg = page.getByRole('dialog', { name: 'Select Connection Profile' });
  await dlg.getByTestId('cm-import').setInputFiles({
    name: 'WbProfiles.xml', mimeType: 'text/xml',
    buffer: Buffer.from('<java><object><void property="name"><string><name>KC_ALO_14</name></string></void></object><name>KC_BSD_01</name></java>'),
  });
  await expect(dlg.getByTestId('cm-test-result')).toContainText('Imported 2 profiles');
  await expect(dlg.getByTestId('cm-list').getByRole('option')).toHaveCount(2);
  await expect(dlg.getByTestId('cm-list')).toContainText('imported');
});

test('failed server save: the browser copy restores the work after reload', async ({ page }) => {
  await start(page);
  await page.evaluate(() => localStorage.setItem('sqlwb.mock.failSave', '1'));
  await typeSql(page, 'select 42 from dual');
  await page.waitForTimeout(1500);
  // Saves keep failing through the reload (also the pagehide save).
  await page.reload();
  await appLoginIfNeeded(page);
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('select 42 from dual');
  await expect(page.getByTestId('messages')).toContainText('restored from it');
});

test('two browser tabs: the older one gets a conflict dialog, not a silent overwrite', async ({ page, context }) => {
  await start(page);
  // Wait for the first save (1 s debounce). Else the second tab loads an old version and gets the conflict itself.
  const ver = () => page.evaluate(() => localStorage.getItem('sqlwb.mock.workspace.ver'));
  await expect.poll(ver).not.toBeNull();
  const other = await context.newPage();
  await start(other);
  const before = await ver();
  await typeSql(other, 'select 1 from dual');
  await expect.poll(ver).not.toBe(before);
  await expect(other.getByRole('dialog')).toBeHidden();
  await typeSql(page, 'select 2 from dual');
  const dlg = page.getByRole('dialog', { name: 'Workspace changed in another browser tab' });
  await expect(dlg).toBeVisible({ timeout: 5000 });
  await dlg.getByRole('button', { name: 'Keep this tab' }).click();
  await expect(dlg).toBeHidden();
});

/** After a reload the mock session survives (sessionStorage); log in only when the form shows. */
async function appLoginIfNeeded(page: Page) {
  const form = page.getByRole('form', { name: 'Log in' });
  await page.waitForTimeout(300);
  if (await form.isVisible()) await appLogin(page);
  const dlg = page.getByRole('dialog');
  if (await dlg.isVisible()) await dlg.getByRole('button', { name: 'Cancel' }).click();
}

test('Connect switches the current statement tab; Connect in new tab adds one', async ({ page }) => {
  await start(page);
  await typeSql(page, 'select 7 from dual');
  await page.keyboard.press('Alt+C');
  const dlg = page.getByRole('dialog', { name: 'Select Connection Profile' });
  await dlg.locator('input[name="profileName"]').fill('FA_11');
  await dlg.locator('input[name="username"]').fill('fa_11');
  await dlg.locator('input[name="password"]').fill('tiger');
  await dlg.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByTestId('messages')).toContainText('as fa_11');
  await expect(page.getByRole('tab', { name: /Statement 2/ })).toHaveCount(0);
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('select 7 from dual');
  await page.keyboard.press('Alt+C');
  await dlg.getByRole('button', { name: 'Connect in new tab' }).click();
  await expect(page.getByRole('tab', { name: /Statement 2/ })).toHaveAttribute('aria-selected', 'true');
});

test('header click sorts: ascending, descending, off; NULL last', async ({ page }) => {
  await start(page);
  await typeSql(page, 'select 30 from emp');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('row-info')).toHaveText('30 rows');
  const firstId = () => page.locator('.grid-row').first().locator('.cell').nth(1).textContent();
  const head = page.getByTestId('head-0');
  await head.click();
  await expect(head).toHaveAttribute('aria-sort', 'ascending');
  expect(await firstId()).toBe('1');
  await head.click();
  await expect(head).toHaveAttribute('aria-sort', 'descending');
  expect(await firstId()).toBe('30');
  // Row number shows the load order, so the edit and delete target the right row
  await expect(page.locator('.grid-row').first().locator('.cell.rownum')).toHaveText('30');
  await head.click();
  await expect(head).toHaveAttribute('aria-sort', 'none');
  expect(await firstId()).toBe('1');
  // AMOUNT_4 is numeric: 10 < 9.5 must not happen; NULL is last
  const amount = page.getByTestId('head-4');
  await amount.click();
  const vals = await page.locator('.grid-row').evaluateAll((rows) => rows
    .sort((a, b) => parseFloat((a as HTMLElement).style.top) - parseFloat((b as HTMLElement).style.top))
    .map((r) => r.querySelectorAll('.cell')[5]?.textContent ?? ''));
  const nums = vals.filter((v) => v !== 'NULL').map(Number);
  expect(nums).toEqual([...nums].sort((a, b) => a - b));
  const firstNull = vals.indexOf('NULL');
  if (firstNull >= 0) expect(vals.slice(firstNull).every((v) => v === 'NULL')).toBe(true);
});

test('double-click on a JSON cell opens the formatted value; Apply writes it back compact', async ({ page }) => {
  await start(page);
  await typeSql(page, 'select 5 from emp where json = 1');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('row-info')).toHaveText('5 rows');
  const cell = page.locator('.grid-row').first().locator('.cell').last();
  await cell.dblclick();
  const dlg = page.getByTestId('cell-dialog');
  await expect(dlg).toBeVisible();
  await expect(dlg.getByLabel('Language')).toHaveValue('json');
  // Pretty: the nested object is on its own lines
  await expect(dlg.locator('.view-line', { hasText: '"owner": {' })).toBeVisible();
  await dlg.locator('.view-line', { hasText: '"id": 1,' }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('00');
  await dlg.getByRole('button', { name: 'Apply to grid' }).click();
  await expect(dlg).toBeHidden();
  await expect(page.locator('.cell.changed')).toHaveText('{"id":100,"tags":["a","b"],"owner":{"name":"User 1","active":true}}');
  // Short values still edit inline
  await page.locator('.grid-row').first().locator('.cell').nth(2).dblclick();
  await expect(page.locator('.cell-input')).toBeVisible();
});

test('auto completion: keywords while typing in the typed case, tables after FROM without Ctrl+Space', async ({ page }) => {
  await start(page);
  const box = page.locator('.suggest-widget');
  await typeSql(page, 'sel');
  await expect(box.locator('.monaco-list-row').first()).toContainText('select');
  await page.keyboard.press('Tab');
  await page.keyboard.type(' * from ');
  await expect(box).toContainText('DEPARTMENTS');
  await expect(box).not.toContainText('ORDER BY');
  await page.keyboard.press('Escape');
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('select * from');
});

test('Escape closes Manage macros opened from the editor; then Ctrl+Enter works again', async ({ page }) => {
  await start(page);
  await typeSql(page, 'select 42');
  await page.keyboard.press('Control+m');
  const dlg = page.getByRole('dialog', { name: 'Manage macros' });
  await expect(dlg).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('row-info')).toHaveText('42 rows');
});

test('Escape closes the connection manager, also when the focus is outside the dialog', async ({ page }) => {
  await start(page);
  await page.keyboard.press('Alt+C');
  const dlg = page.getByRole('dialog', { name: 'Select Connection Profile' });
  await expect(dlg).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  // Focus on the page body: Escape still closes the dialog.
  await page.keyboard.press('Alt+C');
  await expect(dlg).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
});

test('dialog size: drag the grip, size stays after reopen and reload, double-click resets', async ({ page }) => {
  await start(page);
  const dlg = page.getByRole('dialog', { name: 'Select Connection Profile' });
  const size = async () => {
    const b = (await dlg.boundingBox())!;
    return { w: Math.round(b.width), h: Math.round(b.height) };
  };
  await page.keyboard.press('Alt+C');
  await expect(dlg).toBeVisible();
  const def = await size();
  const listH = (await dlg.locator('.cm-list').boundingBox())!.height;
  // Drag the corner grip 100 px left and 80 px up. The dialog stays centered, so the size changes by 2x.
  const g = (await dlg.getByTestId('modal-grip').boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 - 100, g.y + g.height / 2 - 80, { steps: 5 });
  await page.mouse.up();
  const small = await size();
  expect(Math.abs(small.w - (def.w - 200))).toBeLessThanOrEqual(2);
  expect(Math.abs(small.h - (def.h - 160))).toBeLessThanOrEqual(2);
  // The inner layout follows the dialog size.
  expect((await dlg.locator('.cm-list').boundingBox())!.height).toBeLessThan(listH - 100);
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  await page.keyboard.press('Alt+C');
  await expect(dlg).toBeVisible();
  expect(await size()).toEqual(small);
  await page.keyboard.press('Escape');
  await page.reload();
  await dbLogin(page);
  await page.keyboard.press('Alt+C');
  await expect(dlg).toBeVisible();
  expect(await size()).toEqual(small);
  // Double-click the grip: default size, and the saved size is gone.
  await dlg.getByTestId('modal-grip').dblclick();
  expect(await size()).toEqual(def);
  expect(await page.evaluate(() => localStorage.getItem('sqlwb.dialogSize.connections'))).toBeNull();
});

// ---- Hotkeys per OS and the key editor ----

/** Makes the app think it runs on another OS. */
async function emulateOs(page: Page, platform: string) {
  await page.addInitScript((p) => {
    Object.defineProperty(Navigator.prototype, 'platform', { get: () => p });
    Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });
  }, platform);
}

async function menuKey(page: Page, title: string, item: string) {
  await page.locator('.menu-title', { hasText: new RegExp(`^${title}$`) }).click();
  const key = await page.locator('.menu-item', { hasText: item }).first().locator('.menu-key').textContent();
  await page.keyboard.press('Escape');
  return key;
}

async function openKeyEditor(page: Page) {
  await menu(page, 'Help', 'Keyboard shortcuts');
  const dlg = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dlg.getByTestId('key-editor')).toBeVisible();
  return dlg;
}

test('macOS: menus show Mac keys and Cmd+Enter runs the statement', async ({ page }) => {
  await emulateOs(page, 'MacIntel');
  await start(page);
  expect(await menuKey(page, 'SQL', 'Execute Current')).toBe('⌘↩');
  expect(await menuKey(page, 'SQL', 'Execute All')).toBe('⇧⌘E');
  expect(await menuKey(page, 'File', 'Add tab')).toBe('⌥T');
  expect(await menuKey(page, 'Macros', 'Manage macros')).toBe('⇧⌘M');
  await typeSql(page, 'select 7');
  await page.keyboard.press('Meta+Enter');
  await expect(page.getByTestId('row-info')).toHaveText('7 rows');
  const dlg = await openKeyEditor(page);
  await expect(dlg.getByTestId('key-note')).toContainText('macOS');
});

test('Linux: Ctrl keys, browser keys are not shown', async ({ page }) => {
  await emulateOs(page, 'Linux x86_64');
  await start(page);
  expect(await menuKey(page, 'SQL', 'Execute Current')).toBe('Ctrl+Enter');
  expect(await menuKey(page, 'File', 'Add tab')).toBe('Alt+T');
  expect(await menuKey(page, 'View', 'Next tab')).toBe('Alt+PageDown');
  const dlg = await openKeyEditor(page);
  await expect(dlg.getByTestId('key-note')).toContainText('Linux');
});

test('key editor: change Execute Current, the new key runs it, reload keeps it, Reset restores', async ({ page }) => {
  await start(page);
  let dlg = await openKeyEditor(page);
  let row = dlg.getByTestId('key-row-execCurrent');
  await expect(row.getByTestId('key-chip')).toHaveText(['Ctrl+Enter×']);
  await row.getByTestId('key-remove').click();
  await expect(row.getByTestId('key-chip')).toHaveCount(0);
  await row.getByTestId('key-add').click();
  await expect(row.getByTestId('key-recording')).toHaveText('Press keys... (Esc cancels)');
  // Escape stops the recording. The dialog stays open.
  await page.keyboard.press('Escape');
  await expect(row.getByTestId('key-recording')).toHaveCount(0);
  await expect(dlg).toBeVisible();
  await row.getByTestId('key-add').click();
  await page.keyboard.press('Shift'); // modifier only: ignored
  await expect(row.getByTestId('key-recording')).toBeVisible();
  await page.keyboard.press('Alt+X');
  await expect(row.getByTestId('key-chip')).toHaveAttribute('data-key', 'Alt+X');
  await expect(row.getByTestId('key-reset')).toBeVisible();
  await dlg.getByRole('button', { name: 'Close' }).click();
  await expect(dlg).toBeHidden();
  expect(await menuKey(page, 'SQL', 'Execute Current')).toBe('Alt+X');
  await typeSql(page, 'select 7');
  await page.keyboard.press('Alt+X');
  await expect(page.getByTestId('row-info')).toHaveText('7 rows');
  await page.waitForTimeout(1500); // debounce 1 s
  await page.reload();
  await dbLogin(page);
  expect(await menuKey(page, 'SQL', 'Execute Current')).toBe('Alt+X');
  dlg = await openKeyEditor(page);
  row = dlg.getByTestId('key-row-execCurrent');
  await row.getByTestId('key-reset').click();
  await expect(row.getByTestId('key-chip')).toHaveText(['Ctrl+Enter×']);
  await expect(row.getByTestId('key-reset')).toHaveCount(0);
  await dlg.getByRole('button', { name: 'Close' }).click();
  expect(await menuKey(page, 'SQL', 'Execute Current')).toBe('Ctrl+Enter');
});

test('key editor: a reserved browser key is rejected', async ({ page }) => {
  await start(page);
  const dlg = await openKeyEditor(page);
  const row = dlg.getByTestId('key-row-newTab');
  await expect(row.getByTestId('key-chip')).toHaveText(['Alt+T×']);
  await row.getByTestId('key-add').click();
  await page.keyboard.press('Control+T');
  await expect(row.getByTestId('key-msg')).toContainText('The browser or OS keeps this key');
  await expect(row.getByTestId('key-recording')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(row.getByTestId('key-recording')).toHaveCount(0);
  await expect(row.getByTestId('key-chip')).toHaveText(['Alt+T×']);
  await expect(dlg).toBeVisible();
});

test('key editor: a key of another action moves to this action', async ({ page }) => {
  await start(page);
  const dlg = await openKeyEditor(page);
  await dlg.getByTestId('key-filter').fill('execute');
  await expect(dlg.locator('.key-row')).toHaveCount(3);
  const all = dlg.getByTestId('key-row-execAll');
  await all.getByTestId('key-add').click();
  await page.keyboard.press('Control+E');
  await expect(all.getByTestId('key-msg')).toHaveText('Ctrl+E: Moved from Execute Selected.');
  await expect(all.getByTestId('key-chip')).toHaveText(['Ctrl+Shift+E×', 'Ctrl+E×']);
  await expect(dlg.getByTestId('key-row-execSelected').getByTestId('key-chip')).toHaveCount(0);
  await dlg.getByTestId('key-reset-all').click();
  await expect(all.getByTestId('key-chip')).toHaveText(['Ctrl+Shift+E×']);
  await expect(dlg.getByTestId('key-row-execSelected').getByTestId('key-chip')).toHaveText(['Ctrl+E×']);
});

/** Opens the app with a saved workspace on the mock server. */
async function startWithWorkspace(page: Page, doc: object) {
  await page.goto(APP);
  await page.evaluate((d) => localStorage.setItem('sqlwb.mock.workspace', JSON.stringify(d)), doc);
  await page.reload();
  await appLogin(page);
  await dbLogin(page);
}

/** Records one key on the row of this action. */
async function recordKey(page: Page, dlg: ReturnType<Page['getByRole']>, id: string, key: string) {
  const row = dlg.getByTestId(`key-row-${id}`);
  if (!(await row.getByTestId('key-recording').count())) await row.getByTestId('key-add').click();
  await expect(row.getByTestId('key-recording')).toBeVisible();
  await page.keyboard.press(key);
  return row;
}

test('key editor: a key added to Undo runs it; Ctrl+Z in an input stays with the input', async ({ page }) => {
  await start(page);
  await typeSql(page, 'select 1');
  const dlg = await openKeyEditor(page);
  const row = await recordKey(page, dlg, 'undo', 'F9');
  await expect(row.getByTestId('key-chip')).toHaveText(['Ctrl+Zbuilt-in', 'F9×']);
  await dlg.getByRole('button', { name: 'Close' }).click();
  await expect(dlg).toBeHidden();
  // Ctrl+Z in the Max. rows field: the field keeps the focus, the editor text does not change.
  const maxRows = page.locator('#max-rows');
  await maxRows.click();
  await maxRows.press('Control+a');
  await page.keyboard.type('77');
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('max-rows');
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('select 1');
  // F9 runs Undo in the editor.
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.press('F9');
  await expect(page.locator('.monaco-editor .view-lines')).not.toContainText('select 1');
});

test('key editor: built-in editor keys cannot be removed or moved', async ({ page }) => {
  await start(page);
  const dlg = await openKeyEditor(page);
  const replace = dlg.getByTestId('key-row-replace');
  const chip = replace.getByTestId('key-chip');
  await expect(chip).toHaveText(['Ctrl+Hbuilt-in']);
  await expect(chip).toHaveAttribute('title', 'The editor keeps this key');
  await expect(replace.getByTestId('key-remove')).toHaveCount(0);
  // Another action cannot take the key.
  const row = await recordKey(page, dlg, 'findInData', 'Control+H');
  await expect(row.getByTestId('key-msg')).toHaveText('Ctrl+H: The editor keeps this key for Replace....');
  await expect(row.getByTestId('key-recording')).toBeVisible();
  await page.keyboard.press('Escape');
  // Add a key to Replace, remove it, reset: the built-in key stays all the time.
  await recordKey(page, dlg, 'replace', 'F8');
  await expect(chip).toHaveText(['Ctrl+Hbuilt-in', 'F8×']);
  await replace.getByTestId('key-remove').click();
  await expect(chip).toHaveText(['Ctrl+Hbuilt-in']);
  await recordKey(page, dlg, 'replace', 'F8');
  await replace.getByTestId('key-reset').click();
  await expect(chip).toHaveText(['Ctrl+Hbuilt-in']);
  await expect(replace.getByTestId('key-reset')).toHaveCount(0);
});

test('key editor: Ctrl+Alt+letter (AltGr) and Ctrl+C / V / X / A are rejected on Windows', async ({ page }) => {
  await start(page);
  const dlg = await openKeyEditor(page);
  let row = await recordKey(page, dlg, 'execAll', 'Control+Alt+Q');
  await expect(row.getByTestId('key-msg')).toHaveText('Ctrl+Alt+Q: AltGr types characters with this key on many keyboards.');
  row = await recordKey(page, dlg, 'execAll', 'Control+Alt+Shift+2');
  await expect(row.getByTestId('key-msg')).toHaveText('Ctrl+Alt+Shift+2: AltGr types characters with this key on many keyboards.');
  for (const k of ['C', 'V', 'X', 'A']) {
    row = await recordKey(page, dlg, 'execAll', `Control+${k}`);
    await expect(row.getByTestId('key-msg')).toHaveText(`Ctrl+${k}: Copy, paste, cut and select all need this key.`);
  }
  // Function keys and arrows stay allowed with Ctrl+Alt.
  row = await recordKey(page, dlg, 'execAll', 'Control+Alt+F9');
  await expect(row.getByTestId('key-chip')).toHaveText(['Ctrl+Shift+E×', 'Ctrl+Alt+F9×']);
});

test('macOS: Option+letter is rejected in the key editor, Cmd+Option+letter is allowed', async ({ page }) => {
  await emulateOs(page, 'MacIntel');
  await start(page);
  const dlg = await openKeyEditor(page);
  let row = await recordKey(page, dlg, 'execAll', 'Alt+E');
  await expect(row.getByTestId('key-msg')).toHaveText('⌥E: Option types characters with this key.');
  row = await recordKey(page, dlg, 'execAll', 'Alt+Shift+K');
  await expect(row.getByTestId('key-msg')).toHaveText('⌥⇧K: Option types characters with this key.');
  row = await recordKey(page, dlg, 'execAll', 'Meta+Alt+K');
  await expect(row.getByTestId('key-chip')).toHaveText(['⇧⌘E×', '⌥⌘K×']);
});

test('macro with an old lower-case key (ctrl+semicolon) runs', async ({ page }) => {
  await startWithWorkspace(page, { macros: [{ name: 'five', sql: 'select 5', shortcut: 'ctrl+semicolon' }] });
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.press('Control+;');
  await expect(page.getByTestId('row-info')).toHaveText('5 rows');
});

test('Escape during IME composition does not close the dialog', async ({ page }) => {
  await start(page);
  await page.keyboard.press('Alt+C');
  const dlg = page.getByRole('dialog', { name: 'Select Connection Profile' });
  await expect(dlg).toBeVisible();
  await page.evaluate(() => {
    const target = document.activeElement ?? document.body;
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }));
  });
  await page.waitForTimeout(200);
  await expect(dlg).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
});

test('saved keys get the canonical form: "Ctrl+E" on Windows loads as Mod+E and runs', async ({ page }) => {
  await startWithWorkspace(page, {
    keys: { win: { execCurrent: ['Ctrl+E', 'ctrl+e', '', 'Ctrl+', 42], execSelected: [] }, beos: { execAll: ['F2'] } },
  });
  const dlg = await openKeyEditor(page);
  await expect(dlg.getByTestId('key-row-execCurrent').getByTestId('key-chip')).toHaveText(['Ctrl+E×']);
  await expect(dlg.getByTestId('key-row-execCurrent').getByTestId('key-chip')).toHaveAttribute('data-key', 'Mod+E');
  await dlg.getByRole('button', { name: 'Close' }).click();
  await typeSql(page, 'select 9');
  await page.keyboard.press('Control+E');
  await expect(page.getByTestId('row-info')).toHaveText('9 rows');
});
