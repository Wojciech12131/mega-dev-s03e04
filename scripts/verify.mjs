// Lab check of the plan's requirements against the built board, with the incident API faked by page.route.
// Usage: node scripts/verify.mjs [dir]   (default dist/; run scripts/build.mjs first). Exit 0 = every check passed.
// It also measures the product question: does the row under the pointer change when a new incident lands?
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const dir = join(root, process.argv[2] ?? 'dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const path = join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname.replace(/\/$/, '/index.html')));
  if (!existsSync(path)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }).end(readFileSync(path));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  -> ${detail}`}`);
};

const inc = (id, minutesAgo, extra = {}) => ({
  id, service: 'booking-api', region: 'eu-central', summary: `summary ${id}`, severity: 'sev2',
  openedAt: new Date(Date.UTC(2026, 10, 12, 3, 3) - minutesAgo * 60000).toISOString(), ...extra,
});

// A fake API: `state.incidents` is what the next /incidents answers; acks are recorded with the cursor they carried.
async function open(browser, { incidents = [], delayFirst = 0, contextOptions = {} } = {}) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 700 }, ...contextOptions });
  const page = await context.newPage();
  const state = { incidents, calls: 0, acks: [], fail: false };
  await page.route('**/challenges/show-me-when/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/incidents')) {
      state.calls += 1;
      if (state.calls === 1 && delayFirst) await new Promise((r) => setTimeout(r, delayFirst));
      if (state.fail) return route.fulfill({ status: 500, body: 'down' });
      return route.fulfill({ json: { updatedAt: new Date().toISOString(), incidents: state.incidents, cursor: `c${state.calls}` } });
    }
    if (url.pathname.endsWith('/ack')) {
      state.acks.push({ id: url.searchParams.get('id'), cursor: url.searchParams.get('cursor') });
      return route.fulfill({ json: { id: url.searchParams.get('id'), ackedAt: new Date().toISOString(), receipt: 'r-test' } });
    }
    return route.fulfill({ status: 404 });
  });
  await page.goto(base);
  return { page, state, context };
}

const ids = (page) => page.$$eval('[data-testid="incident-row"]', (els) => els.map((e) => e.dataset.id));

const browser = await chromium.launch();
try {
  // R6
  {
    const { page, context } = await open(browser, { incidents: [inc('INC-1', 1)] });
    const meta = await page.getAttribute('meta[name="build"]', 'content');
    const foot = await page.textContent('[data-testid="build-sha"]');
    check('R6 meta build = footer sha, full 40-char sha', /^[0-9a-f]{40}$/.test(meta) && meta === foot.trim(), `${meta} / ${foot}`);
    check('R6 footer sha visible in viewport', await page.isVisible('[data-testid="build-sha"]'));
    await context.close();
  }
  // R3 loader, then list
  {
    const { page, context } = await open(browser, { incidents: [inc('INC-1', 1)], delayFirst: 800 });
    check('R3 loader visible on open', await page.isVisible('[data-testid="loader"]'));
    await page.waitForSelector('[data-testid="incident-row"]');
    check('R3 loader gone once incidents load', (await page.$('[data-testid="loader"]')) === null);
    check('board area present', await page.isVisible('[data-testid="board"]'));
    await context.close();
  }
  // empty state, then incidents arrive
  {
    const { page, state, context } = await open(browser, { incidents: [] });
    await page.waitForSelector('[data-testid="empty"]:visible');
    check('empty shows when there are no incidents', await page.isVisible('[data-testid="empty"]'));
    state.incidents = [inc('INC-7', 0)];
    await page.waitForSelector('[data-testid="incident-row"]', { timeout: 5000 });
    check('empty goes away when an incident arrives', !(await page.isVisible('[data-testid="empty"]')));
    await context.close();
  }
  // R1 + R4: live insert at top without reload; R2 ack survives refresh; cursor is passed
  {
    const { page, state, context } = await open(browser, { incidents: [inc('INC-2', 5), inc('INC-1', 10)] });
    await page.waitForSelector('[data-testid="incident-row"]');
    check('R1 newest first', JSON.stringify(await ids(page)) === '["INC-2","INC-1"]', JSON.stringify(await ids(page)));
    await page.evaluate(() => (window.__noReload = true));
    const t0 = Date.now();
    state.incidents = [inc('INC-3', 0), ...state.incidents];
    await page.waitForFunction(() => document.querySelector('[data-testid="incident-row"]')?.dataset.id === 'INC-3', null, { timeout: 5000 });
    const waited = Date.now() - t0;
    check('R1/R4 new incident at top without reload', await page.evaluate(() => window.__noReload === true));
    check('R4 refresh within ~2 s', waited <= 2600, `${waited} ms`);
    const keep = await page.$('[data-testid="incident-row"][data-id="INC-1"]');
    check('SCHED-4515 rows have no Ack button', (await page.$('[data-testid="incident-row"] [data-testid="ack"]')) === null);
    check('SCHED-4515 panel hidden until a row is picked', !(await page.isVisible('[data-testid="incident-panel"]')));
    await page.click('[data-testid="incident-row"][data-id="INC-2"]');
    const panelText = await page.textContent('[data-testid="incident-panel"]');
    check('SCHED-4515 row click opens the panel naming that incident only', panelText.includes('INC-2') && !/INC-(1|3)\b/.test(panelText), panelText);
    check('SCHED-4515 a row click sends no ack', state.acks.length === 0, JSON.stringify(state.acks));
    await page.click('[data-testid="panel-ack"]');
    await page.waitForSelector('[data-testid="incident-row"][data-id="INC-2"] [data-testid="acked"]');
    check('R2 panel Ack calls api with that id and the latest cursor', state.acks.length === 1 && state.acks[0].id === 'INC-2' && /^c\d+$/.test(state.acks[0].cursor), JSON.stringify(state.acks));
    check('R2 panel shows acked, its Ack gone', !(await page.isVisible('[data-testid="panel-ack"]')) && /acked/.test(await page.textContent('[data-testid="incident-panel"]')));
    const callsBefore = state.calls;
    state.incidents = [inc('INC-4', 0), ...state.incidents];
    await page.waitForTimeout(4500);
    check('R4 kept refreshing (2+ calls in 4.5 s)', state.calls - callsBefore >= 2, `${state.calls - callsBefore}`);
    check('panel stays on its incident while new incidents land', (await page.textContent('[data-testid="incident-panel"] h2')).trim() === 'INC-2');
    check('R2 acked mark survives refresh', await page.isVisible('[data-testid="incident-row"][data-id="INC-2"] [data-testid="acked"]'));
    check('rows updated in place (same DOM node after refresh)', await keep.evaluate((n) => n.isConnected));
    await page.keyboard.press('Escape');
    check('Escape closes the panel', !(await page.isVisible('[data-testid="incident-panel"]')));
    await page.focus('[data-testid="incident-row"][data-id="INC-1"]');
    await page.keyboard.press('Enter');
    check('Enter on a focused row opens its panel', (await page.textContent('[data-testid="incident-panel"] h2')).trim() === 'INC-1');
    await context.close();
  }
  // The step-1 race, clicked the way the replay clicks: aim at a row, a new incident lands, click the same spot.
  {
    const { page, state, context } = await open(browser, {
      incidents: [inc('INC-3', 5), inc('INC-2', 10), inc('INC-1', 15)],
      contextOptions: { viewport: { width: 1280, height: 800 } },
    });
    await page.waitForSelector('[data-testid="incident-row"]');
    await page.evaluate(() => {
      window.__removed = 0;
      new MutationObserver((rs) => { for (const r of rs) for (const n of r.removedNodes) if (n.nodeType === 1 && n.matches?.('[data-testid="incident-row"]')) window.__removed++; })
        .observe(document, { childList: true, subtree: true });
    });
    const meant = 'INC-1';
    const box = await page.locator(`[data-testid="incident-row"][data-id="${meant}"]`).boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid="incident-row"]')?.dataset.id, [x, y]);
    check('panel column does not cover the rows at 1280x800', hit === meant, hit);
    await page.mouse.move(x, y, { steps: 8 });
    state.incidents = [inc('INC-9', 0), ...state.incidents];
    await page.waitForFunction(() => document.querySelector('[data-testid="incident-row"]')?.dataset.id === 'INC-9', null, { timeout: 5000 });
    await page.mouse.click(x, y);
    const wrong = (await page.textContent('[data-testid="incident-panel"] h2')).trim();
    check('race: the click lands on a moved row and opens the wrong panel', wrong !== meant, wrong);
    check('race: the wrong click acks nothing', state.acks.length === 0, JSON.stringify(state.acks));
    await page.locator(`[data-testid="incident-row"][data-id="${meant}"]`).click();
    check('race: picking the intended row again names it in the panel', (await page.textContent('[data-testid="incident-panel"]')).includes(meant));
    await page.click('[data-testid="panel-ack"]');
    await page.waitForSelector(`[data-testid="incident-row"][data-id="${meant}"] [data-testid="acked"]`);
    check('race: expected = got', state.acks.length === 1 && state.acks[0].id === meant, JSON.stringify(state.acks));
    check('no incident row removed from the board during refreshes', (await page.evaluate(() => window.__removed)) === 0);
    await context.close();
  }
  // summary is text, not HTML
  {
    const { page, context } = await open(browser, { incidents: [inc('INC-X', 1, { summary: '<img src=x onerror=window.__pwned=1>' })] });
    await page.waitForSelector('[data-testid="incident-row"]');
    check('summary rendered as text (no HTML injection)', (await page.$('[data-testid="incident-row"] img')) === null);
    await context.close();
  }
  // R5 local times
  // One instant, 2026-11-12T03:03Z: Auckland (NZDT, +13) 12/11 16:03; Berlin (CET, +1) 12.11. 04:03;
  // New York (EST, -5) 11/11 22:03, month first.
  const at = '2026-11-12T03:03:00.000Z';
  for (const [zone, locale, expect] of [
    ['Pacific/Auckland', 'en-NZ', /^12\/11,? (4:03\s?pm|16:03)/i], // not "04:03 pm": reads as 04:03
    ['Europe/Berlin', 'de-DE', /^12\.11\.,? 04:03/],
    ['America/New_York', 'en-US', /^11\/11,? 10:03\s?PM/i],
    ['Europe/Warsaw', 'pl-PL', /^12\.11,? 04:03/],
    ['Europe/London', 'en-GB', /^12\/11,? 03:03/],
  ]) {
    const { page, context } = await open(browser, {
      incidents: [{ ...inc('INC-T', 0), openedAt: at }],
      contextOptions: { timezoneId: zone, locale },
    });
    await page.waitForSelector('[data-testid="incident-row"] time');
    const text = (await page.textContent('[data-testid="incident-row"] time')).trim();
    const attr = await page.getAttribute('[data-testid="incident-row"] time', 'datetime');
    check(`R5 ${zone} ${locale}: "${text}"`, expect.test(text), `${text} for ${at}`);
    check(`R5 ${zone}: full UTC kept in datetime`, attr === at, attr);
    await context.close();
  }
  // API down: board says so and keeps trying
  {
    const { page, state, context } = await open(browser, { incidents: [inc('INC-1', 1)] });
    await page.waitForSelector('[data-testid="incident-row"]');
    state.fail = true;
    await page.waitForSelector('#status.bad', { timeout: 5000 });
    state.fail = false;
    await page.waitForSelector('#status:not(.bad)', { timeout: 5000 });
    check('API error shown, then recovers without reload', true);
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
