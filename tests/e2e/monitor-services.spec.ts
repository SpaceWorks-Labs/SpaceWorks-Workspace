import { expect, test } from './browser-fixtures';

// Run against the local demo seed; no cloud credentials or API calls.
test.use({ viewport: { width: 375, height: 812 } });
test.skip(!process.env.DEMO_PASSWORD, 'Seed the demo workspace and set DEMO_PASSWORD first.');
async function signIn(page: import('@playwright/test').Page, email: string) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(process.env.DEMO_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/w/**');
}
test('admin can review services at 375px and create a heartbeat with scoped destinations', async ({ page }) => {
  await signIn(page, 'admin@tinkerspace.test');
  const base = '/w/tinkerspace-kochi/services';
  await page.goto(base);
  await expect(page.getByRole('heading', { name: 'Services', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Community website', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/monitor-overview-mobile.png', fullPage: true });
  for (const path of ['/incidents', '/maintenance', '/cloud', '/costs', '/on-call', '/settings', '/status-page']) {
    await page.goto(`${base}${path}`); await expect(page.locator('main h1').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path).toBe(true);
  }
  await page.goto(`${base}/monitors/new`);
  await page.getByLabel('Monitor name', { exact: true }).fill(`Browser heartbeat ${Date.now()}`);
  await page.getByRole('combobox', { name: 'Check type', exact: true }).click();
  await page.getByRole('option', { name: 'Heartbeat (cron job)', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Send to', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create monitor', exact: true }).click();
  await expect(page.getByText('Copy this heartbeat URL now. It is shown once.')).toBeVisible();
  await page.getByRole('button', { name: 'Open monitor', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Heartbeat setup' })).toBeVisible();
});
test('guest cannot view services or cloud-account settings', async ({ page }) => {
  await signIn(page, 'guest@tinkerspace.test');
  const response = await page.goto('/w/tinkerspace-kochi/services'); expect([200, 404]).toContain(response?.status());
  await expect(page.getByRole('heading', { name: "There's nothing here.", exact: true })).toBeVisible();
  const settings = await page.goto('/w/tinkerspace-kochi/settings/cloud-accounts'); expect([200, 404]).toContain(settings?.status());
  await expect(page.getByRole('heading', { name: "There's nothing here.", exact: true })).toBeVisible();
});
