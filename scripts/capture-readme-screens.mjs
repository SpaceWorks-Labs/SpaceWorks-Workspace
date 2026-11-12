// Operator-only screenshot capture. Never seed production or launch from CI deployment jobs.
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
const base = new URL(process.argv[2] || 'http://localhost:3290');
if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error('Use an HTTP(S) base URL without credentials.');
const password = process.env.DEMO_PASSWORD;
if (!password) throw new Error('Set DEMO_PASSWORD to the seeded demo owner password.');
const out = path.resolve(import.meta.dirname, '../docs/readme/screens');
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(new URL('/login', base).href);
  await page.getByLabel('Email', { exact: true }).fill(process.env.DEMO_EMAIL || 'owner@tinkerspace.test');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/w\//);
  const match = new URL(page.url()).pathname.match(/^\/w\/([^/]+)/);
  if (!match) throw new Error('Sign-in did not reach the demo workspace.');
  const workspace = `/w/${match[1]}`;
  const projectResponse = await page.goto(new URL(`${workspace}/projects`, base).href);
  if (!projectResponse?.ok()) throw new Error('Demo projects could not be loaded.');
  const board = await page.locator(`a[href^="${workspace}/projects/"]:not([href*="/blockers"])`).first().getAttribute('href');
  if (!board) throw new Error('Seed a demo project before capturing screenshots.');
  const screens = [
    ['home', workspace], ['project-board', board], ['project-list', `${board}?view=list`], ['my-tasks', `${workspace}/my-tasks`], ['calendar', `${workspace}/calendar?view=week`], ['chat', `${workspace}/chat/general`],
    ['docs', `${workspace}/docs`], ['notepad', `${workspace}/notepad`], ['finance-dark', `${workspace}/finance`], ['finance-dues', `${workspace}/finance/dues`],
    ['funding', `${workspace}/funding`], ['analytics', `${workspace}/analytics`], ['secrets', `${workspace}/secrets`], ['bom-estimates', `${workspace}/product-ops/estimates`],
    ['governance', `${workspace}/governance`], ['organisation', `${workspace}/organisation`], ['services', `${workspace}/services`], ['helpdesk', `${workspace}/helpdesk`],
  ];
  for (const [name, route] of screens) {
    const mode = name.endsWith('-dark') ? 'dark' : 'light';
    await context.addCookies([{ name: 'sww.color-mode', value: mode, url: base.origin }]);
    await page.emulateMedia({ colorScheme: mode });
    const response = await page.goto(new URL(route, base).href, { waitUntil: 'load' });
    if (!response?.ok() || new URL(page.url()).pathname === '/login') throw new Error(`Could not capture ${name}: the page did not load. `);
    await page.locator('main').waitFor({ state: 'visible' });
    // Streamed pages show a loading state first; wait until it has been replaced.
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => !/^\s*Loading\b/m.test(document.querySelector('main')?.innerText ?? ''), null, { timeout: 30_000 });
    await page.evaluate(mode => { document.documentElement.dataset.colorMode = mode; localStorage.setItem('sww:color-mode', mode); }, mode);
    // Hide the Next.js dev overlay badge when capturing against `npm run dev`.
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const png = await page.screenshot({ fullPage: false, animations: 'disabled' });
    await sharp(png).webp({ quality: 86 }).toFile(path.join(out, `${name}.webp`));
    console.log(`Saved ${name}.webp (1440×900)`);
  }
} finally { await browser.close(); }
