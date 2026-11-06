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

  test('switch profile from DB Explorer: statement tab and explorer follow, no new tabs', async ({ page }) => {
    await start(page);
    await page.locator('[data-action="dbExplorer"]').click();
    await expect(page.getByRole('tab', { name: /DB Explorer/ })).toBeVisible();
    const tabs = page.getByRole('tab');
    const count = await tabs.count();
    for (const name of ['SCHEMA_B', 'SCHEMA_C']) {
      await page.keyboard.press('Alt+C');
      const cm = page.getByRole('dialog', { name: 'Select Connection Profile' });
      await cm.locator('input[name="profileName"]').fill(name);
      await cm.locator('input[name="username"]').fill('scott');
      await cm.locator('input[name="password"]').fill('tiger');
      await cm.getByRole('button', { name: 'Connect', exact: true }).click();
      await expect(cm).toBeHidden();
      await expect(page.locator('.tb-conn .conn-state.connected')).toBeVisible();
      await expect(tabs).toHaveCount(count);
      // Both tabs sit in the group of the new schema. The old group is gone.
      const group = page.getByRole('group', { name });
      await expect(group.getByRole('tab', { name: /Statement 1/ })).toBeVisible();
      await expect(group.getByRole('tab', { name: /DB Explorer/ })).toBeVisible();
      await expect(page.getByTestId('tab-group')).toHaveCount(1);
      // Ctrl+D from the statement tab re-uses the same explorer.
      await page.getByRole('tab', { name: /Statement 1/ }).click();
      await page.locator('[data-action="dbExplorer"]').click();
      await expect(page.getByRole('tab', { name: /DB Explorer/ })).toHaveCount(1);
      await expect(tabs).toHaveCount(count);
    }
    // Collapse the group: only the active tab stays visible, with the tab count.
    const group = page.getByRole('group', { name: 'SCHEMA_C' });
    await group.getByRole('button', { name: /SCHEMA_C/ }).click();
    await expect(group.getByRole('tab')).toHaveCount(1);
    await expect(group.locator('.tgroup-count')).toHaveText('2');
    await group.getByRole('button', { name: /SCHEMA_C/ }).click();
    await expect(group.getByRole('tab')).toHaveCount(2);
  });

  test('tabs of different schemas are in separate groups', async ({ page }) => {
    await start(page);
    await page.keyboard.press('Alt+C');
    const cm = page.getByRole('dialog', { name: 'Select Connection Profile' });
    await cm.locator('input[name="profileName"]').fill('OTHER');
    await cm.locator('input[name="username"]').fill('scott');
    await cm.locator('input[name="password"]').fill('tiger');
    await cm.getByRole('button', { name: 'Connect in new tab' }).click();
    await expect(page.locator('.tb-conn .conn-state.connected')).toBeVisible();
    await expect(page.getByTestId('tab-group')).toHaveCount(2);
    await expect(page.getByRole('group', { name: 'OTHER' }).getByRole('tab', { name: /Statement 2/ })).toBeVisible();
    // One DB Explorer per schema: 2 explorers now.
    await page.locator('[data-action="dbExplorer"]').click();
    await page.getByRole('tab', { name: /Statement 1/ }).click();
    await page.locator('[data-action="dbExplorer"]').click();
    await expect(page.getByRole('tab', { name: /DB Explorer/ })).toHaveCount(2);
    // Connect (not "in new tab"): ALL tabs switch to that schema, and only one DB Explorer stays.
    await page.keyboard.press('Alt+C');
    await cm.locator('input[name="profileName"]').fill('ALL');
    await cm.locator('input[name="username"]').fill('scott');
    await cm.locator('input[name="password"]').fill('tiger');
    await cm.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(cm).toBeHidden();
    await expect(page.getByTestId('tab-group')).toHaveCount(1);
    const group = page.getByRole('group', { name: 'ALL' });
    for (const t of [/Statement 1/, /Statement 2/, /DB Explorer/]) await expect(group.getByRole('tab', { name: t })).toBeVisible();
    await expect(page.locator('.stab-off')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /DB Explorer/ })).toHaveCount(1);
    // The active explorer stayed and is connected.
    await expect(group.getByRole('tab', { name: /DB Explorer/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('tab groups move to a sidebar and back, like Edge vertical tabs', async ({ page }) => {
    await start(page);
    const bar = page.getByTestId('tabbar');
    const ws = page.locator('.workspace');
    await expect(bar).toHaveAttribute('aria-orientation', 'horizontal');
    await page.locator('[data-action="verticalTabs"]').click();
    await expect(bar).toHaveAttribute('aria-orientation', 'vertical');
    // Sidebar on the left of the workspace, full height of the work area.
    const b = (await bar.boundingBox())!;
    const w = (await ws.boundingBox())!;
    expect(b.x + b.width).toBeLessThanOrEqual(w.x + 1);
    expect(Math.abs(b.y - w.y)).toBeLessThan(2);
    await expect(page.getByTestId('tab-group')).toHaveCount(1);
    await page.getByRole('button', { name: 'Add tab' }).click();
    await expect(page.getByRole('tab', { name: /Statement 2/ })).toBeVisible();
    // Tabs stack under each other.
    const t1 = (await page.getByRole('tab', { name: /Statement 1/ }).boundingBox())!;
    const t2 = (await page.getByRole('tab', { name: /Statement 2/ }).boundingBox())!;
    expect(t2.y).toBeGreaterThan(t1.y);
    // Drag the right edge: the sidebar gets wider.
    const edge = page.locator('.tabbar-resize');
    const e = (await edge.boundingBox())!;
    await page.mouse.move(e.x + e.width / 2, e.y + 100);
    await page.mouse.down();
    await page.mouse.move(e.x + e.width / 2 + 80, e.y + 100, { steps: 4 });
    await page.mouse.up();
    expect((await bar.boundingBox())!.width).toBeGreaterThan(b.width + 60);
    // The shortcut toggles both ways.
    await page.keyboard.press('Alt+Shift+T');
    await expect(bar).toHaveAttribute('aria-orientation', 'horizontal');
    await page.keyboard.press('Alt+Shift+T');
    await expect(bar).toHaveAttribute('aria-orientation', 'vertical');
    // The choice survives a reload. The button moves the tabs back to the top.
    await page.reload();
    await expect(bar).toHaveAttribute('aria-orientation', 'vertical');
    await dbLogin(page);
    await page.locator('[data-action="verticalTabs"]').click();
    await expect(bar).toHaveAttribute('aria-orientation', 'horizontal');
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
