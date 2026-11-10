import { expect, test, type Page } from '@playwright/test';

// Compare tab (mock server): sample table APP_SETTINGS in SHOP_DEV, SHOP_TEST and SHOP_UAT.
const REAL = !!process.env.PW_BASE_URL;
const SQL = "select * from SHOP_DEV.APP_SETTINGS where SETTING_KEY like 'mail.%'";

async function start(page: Page) {
  await page.goto('/?mock=1');
  const form = page.getByRole('form', { name: 'Log in' });
  await form.locator('input[name="appUser"]').fill('tester');
  await form.locator('input[name="appPassword"]').fill('secret');
  await form.getByRole('button', { name: 'Log in' }).click();
  const dlg = page.getByRole('dialog');
  const user = dlg.locator('input[name="username"]');
  if (await user.count()) await user.fill('scott');
  await dlg.locator('input[name="password"]').fill('tiger');
  await dlg.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.locator('.tb-conn .conn-state.connected')).toBeVisible();
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.type(SQL);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('row-info')).toHaveText('14 rows');
}

/** Menu Tools > Compare data: a new Compare tab. */
async function openCompareTab(page: Page) {
  await page.getByRole('menuitem', { name: 'Tools' }).click();
  await page.getByRole('menuitem', { name: /Compare data/ }).click();
  return page.getByTestId('compare');
}

/** Compare tab: A = SHOP_DEV, B = SHOP_TEST; matches by SETTING_KEY, ignores SETTING_ID and UPDATED_AT. */
async function compare(page: Page) {
  const cmp = await openCompareTab(page);
  await cmp.getByLabel('Schema of A').selectOption('SHOP_DEV');
  await cmp.getByLabel('Schema of B').selectOption('SHOP_TEST');
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.type(SQL);
  await page.keyboard.press('Escape');
  await cmp.getByTestId('compare-run').click();
  await expect(cmp.getByTestId('compare-status')).toContainText('Compared 14 + 14 rows');
  const match = cmp.locator('fieldset', { hasText: 'Match rows by' });
  const ign = cmp.locator('fieldset', { hasText: 'Ignore columns' });
  await match.getByLabel('SETTING_ID').uncheck();
  await match.getByLabel('SETTING_KEY').check();
  await ign.getByLabel('SETTING_ID').check();
  await ign.getByLabel('UPDATED_AT').check();
  return cmp;
}

test.describe('compare', () => {
  test.skip(REAL, 'mock only');

  test('chips count the rows by status; options change the result', async ({ page }) => {
    await start(page);
    const cmp = await compare(page);
    await expect(cmp.locator('.chip.c-chg b')).toHaveText('8');
    await expect(cmp.locator('.chip.c-del b')).toHaveText('1');
    await expect(cmp.locator('.chip.c-add b')).toHaveText('1');
    await expect(cmp.locator('.chip.c-same b')).toHaveText('5');
    // "Case differs": STARTTLS = starttls, "ON " = "on".
    await cmp.getByLabel('Case differs').check();
    await expect(cmp.locator('.chip.c-chg b')).toHaveText('6');
    // Same rows are hidden until their chip is on.
    await expect(cmp.locator('tbody tr', { hasText: 'mail.transport' })).toHaveCount(0);
    await cmp.locator('.chip.c-same').click();
    await expect(cmp.locator('tbody tr', { hasText: 'mail.transport' })).toHaveCount(1);
    await page.getByTestId('tab-compare-sql').click();
    await expect(page.getByTestId('compare-sql')).toContainText('full outer join b on a.SETTING_KEY = b.SETTING_KEY');
    await expect(page.getByTestId('compare-sql')).toContainText('SHOP_TEST.APP_SETTINGS');
  });

  test('A → B, review, revert, save', async ({ page }) => {
    await start(page);
    const cmp = await compare(page);
    const row = cmp.locator('tbody tr', { hasText: 'mail.timeout.ms' });
    const copyBox = (await row.getByRole('button', { name: 'A → B' }).boundingBox())!;
    await row.getByRole('button', { name: 'A → B' }).click();
    // The row is now the same, but it stays visible with its pending change. The focus stays on the row.
    await expect(row).toHaveClass(/dirty/);
    await expect(row.getByRole('button', { name: '↶ Revert' })).toBeFocused();
    // Revert has its own slot: a second click on the same place does not undo the copy.
    const revBox = (await row.getByRole('button', { name: '↶ Revert' }).boundingBox())!;
    expect(revBox.x).toBeGreaterThanOrEqual(copyBox.x + copyBox.width);
    await cmp.locator('tbody tr', { hasText: 'mail.debug' }).getByRole('button', { name: 'Insert in B' }).click();
    await expect(cmp.getByText('2 pending changes')).toBeVisible();
    await cmp.getByTestId('compare-review').click();
    const dlg = page.getByTestId('compare-review-dialog');
    await expect(dlg).toContainText("UPDATE SHOP_TEST.APP_SETTINGS SET SETTING_VALUE = '3000' WHERE SETTING_ID = 203;");
    await expect(dlg).toContainText('INSERT INTO SHOP_TEST.APP_SETTINGS');
    // Revert the insert: one statement is left.
    await dlg.locator('.item', { hasText: 'INSERT' }).getByRole('button', { name: '↶ Revert' }).click();
    await expect(dlg.locator('.item')).toHaveCount(1);
    await dlg.getByTestId('compare-save').click();
    await expect(dlg).toBeHidden();
    await expect(cmp.getByTestId('compare-status')).toContainText('Saved 1 statement. Committed.');
    await expect(cmp.getByText('No pending changes')).toBeVisible();
    // A new run reads the saved value: one changed row less.
    await cmp.getByTestId('compare-run').click();
    await expect(cmp.locator('.chip.c-chg b')).toHaveText('7');
  });

  test('edit dialog: JSON paths, live diff, copy, maximize, the primary key is read-only', async ({ page }) => {
    await start(page);
    const cmp = await compare(page);
    await cmp.locator('tbody tr', { hasText: 'mail.retry.policy' }).getByRole('button', { name: /changes/ }).click();
    const dlg = page.getByTestId('compare-edit');
    await expect(dlg.locator('table.paths')).toContainText('$.max');
    await expect(dlg.locator('table.paths')).toContainText('$.delays[3]');
    await page.getByRole('button', { name: 'Maximize' }).click();
    await expect(page.locator('.modal.max')).toBeVisible();
    await page.getByRole('button', { name: 'Restore size' }).click();
    await dlg.getByRole('button', { name: 'Copy A value into B' }).click();
    await expect(dlg).toContainText('no differences');
    await dlg.getByTestId('compare-apply').click();
    const row = cmp.locator('tbody tr', { hasText: 'mail.retry.policy' });
    await expect(row).toHaveClass(/dirty/);
    await expect(row).toHaveClass(/same/);
    // Primary key cell: read-only.
    await row.locator('td.cell').first().dblclick();
    await expect(page.getByRole('dialog')).toContainText('primary key, read-only');
    await expect(page.locator('#cmp-eA')).toHaveAttribute('readonly', '');
  });

  test('path table: an emptied array is one row, in tree order; moved lines get a soft mark', async ({ page }) => {
    await start(page);
    const cmp = await compare(page);
    await cmp.locator('tbody tr', { hasText: 'mail.retry.policy' }).getByRole('button', { name: /changes/ }).click();
    const dlg = page.getByTestId('compare-edit');
    await page.locator('#cmp-eB').fill('{"max":3,"backoff":"exponential","delays":[],"notify":{"onFail":true,"to":"ops@dev.example.com"}}');
    const rows = dlg.locator('table.paths tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('$.delays');
    await expect(rows.first()).toContainText('[1,5,30]');
    await expect(rows.first()).toContainText('[]');
    // Same content, other key order: no line is a change, the moved lines get the soft mark.
    await page.locator('#cmp-eA').fill('{\n"a": 1,\n"b": 2\n}');
    await page.locator('#cmp-eB').fill('{\n"b": 2,\n"a": 1\n}');
    await expect(dlg).toContainText('same lines, only order or spaces differ');
    await expect(dlg.locator('.tb .hl .lm').first()).toBeAttached();
    await expect(dlg.locator('.tb .hl .ld, .tb .hl .la')).toHaveCount(0);
  });

  test('A can change; options are kept for the next compare; header fit does not grow', async ({ page }) => {
    await start(page);
    let cmp = await compare(page);
    await expect(cmp.getByLabel('Schema of A')).toHaveValue('SHOP_DEV');
    await cmp.getByLabel('Schema of A').selectOption('SHOP_UAT');
    await cmp.getByTestId('compare-run').click();
    await expect(cmp.locator('.cmp-sum')).toContainText('SHOP_UAT');
    // Double-click on a header border fits the column; a second double-click keeps the same width.
    const th = cmp.locator('thead th', { hasText: 'SETTING_KEY' });
    const rz = th.locator('.rz');
    await rz.dblclick();
    const w1 = (await th.boundingBox())!.width;
    await rz.dblclick();
    await rz.dblclick();
    expect(Math.abs((await th.boundingBox())!.width - w1)).toBeLessThan(2);
    // Options are kept for the next Compare tab.
    await cmp.getByLabel('Case differs').check();
    cmp = await openCompareTab(page);
    await expect(cmp.getByLabel('Case differs')).toBeChecked();
    await expect(cmp.getByTestId('compare-status')).not.toContainText('Compared');
  });

  test('a connection named like a schema selects that schema', async ({ page }) => {
    // Users name a profile after its schema. Picking the profile picks the schema: no second click.
    await page.addInitScript(() => {
      const p = (name: string) => ({
        name, group: '', url: 'jdbc:oracle:thin:@//localhost:1521/FREEPDB1', user: 'scott', password: 'tiger', savePassword: true, autocommit: false,
      });
      localStorage.setItem('sqlwb.mock.profiles', JSON.stringify({ profiles: [p('shop-uat'), p('SHOP_TEST')] }));
    });
    await start(page);
    const cmp = await openCompareTab(page);
    await cmp.getByLabel('Connection of B').selectOption({ label: 'shop-uat' });
    await expect(cmp.getByLabel('Schema of B')).toHaveValue('SHOP_UAT');
    await cmp.getByLabel('Connection of A').selectOption({ label: 'SHOP_TEST' });
    await expect(cmp.getByLabel('Schema of A')).toHaveValue('SHOP_TEST');
    // A schema picked by hand stays.
    await cmp.getByLabel('Schema of A').selectOption('');
    await cmp.getByLabel('Connection of B').selectOption({ label: 'SHOP_TEST' });
    await expect(cmp.getByLabel('Schema of A')).toHaveValue('');
  });

  test('a new Compare tab starts with the last A and B; the schema list shows at once', async ({ page }) => {
    await start(page);
    let cmp = await openCompareTab(page);
    await cmp.getByLabel('Schema of A').selectOption('SHOP_TEST');
    await cmp.getByLabel('Schema of B').selectOption('SHOP_UAT');
    cmp = await openCompareTab(page);
    await expect(cmp.getByLabel('Schema of A')).toHaveValue('SHOP_TEST');
    await expect(cmp.getByLabel('Schema of B')).toHaveValue('SHOP_UAT');
    await expect(cmp.getByLabel('Schema of B').locator('option', { hasText: 'SHOP_DEV' })).toHaveCount(1);
  });

  test('menu opens Compare; no Compare button on a result; Ctrl+Enter runs; the table picker fills the editor', async ({ page }) => {
    await start(page);
    await expect(page.getByTestId('open-compare')).toHaveCount(0);
    const cmp = await openCompareTab(page);
    await cmp.getByLabel('Schema of A').selectOption('SHOP_DEV');
    await cmp.getByLabel('Table').selectOption({ index: 1 });
    await expect(page.locator('.monaco-editor .view-lines')).toContainText('select * from SHOP_DEV.');
    await expect(cmp.getByLabel('Table')).not.toHaveValue('');
    await cmp.getByLabel('Schema of B').selectOption('SHOP_TEST');
    await page.locator('.monaco-editor .view-lines').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(SQL);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+Enter');
    await expect(cmp.getByTestId('compare-status')).toContainText('Compared');
  });

  test('header click sorts: ascending, descending, off; a resize does not sort', async ({ page }) => {
    await start(page);
    const cmp = await compare(page);
    const th = cmp.locator('thead th', { hasText: 'SETTING_KEY' });
    const first = cmp.locator('tbody tr').first();
    await th.click();
    await expect(th).toHaveAttribute('aria-sort', 'ascending');
    await expect(first).toContainText('mail.audit');
    await th.click();
    await expect(th).toHaveAttribute('aria-sort', 'descending');
    await expect(first).toContainText('mail.tls');
    await th.locator('.rz').click();
    await expect(th).toHaveAttribute('aria-sort', 'descending');
    await th.click();
    await expect(th).not.toHaveAttribute('aria-sort', /.+/);
  });

  test('hide ignored columns; the Actions column stays on the right edge', async ({ page }) => {
    await start(page);
    const cmp = await compare(page);
    await expect(cmp.locator('thead th', { hasText: 'UPDATED_AT' })).toHaveCount(1);
    await cmp.getByLabel('Hide ignored columns in the grid').check();
    await expect(cmp.locator('thead th', { hasText: 'UPDATED_AT' })).toHaveCount(0);
    await expect(cmp.locator('thead th', { hasText: 'SETTING_ID' })).toHaveCount(0);
    await expect(cmp.locator('thead th', { hasText: 'SETTING_KEY' })).toHaveCount(1);
    await cmp.getByLabel('Hide ignored columns in the grid').uncheck();
    await expect(cmp.locator('thead th', { hasText: 'UPDATED_AT' })).toHaveCount(1);
    // Make the grid wider than the view: the row buttons stay inside it.
    const rz = cmp.locator('thead th', { hasText: 'DESCRIPTION' }).locator('.rz');
    await rz.focus();
    for (let i = 0; i < 80; i++) await page.keyboard.press('ArrowRight');
    const grid = (await cmp.locator('.cmp-grid').boundingBox())!;
    const btn = (await cmp.locator('tbody tr').first().locator('td.ra').boundingBox())!;
    expect(btn.x + btn.width).toBeLessThanOrEqual(grid.x + grid.width + 1);
  });
});
