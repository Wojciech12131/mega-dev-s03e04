// Records the board in use (open-board, watch-board, ack-incident) against a real URL, with Playwright video.
// The recording script alone adds an overlay: elapsed mm:ss on the video's own clock, the page origin, the build
// sha, a visible pointer, and captions. Event times, the ack receipt and the sha go to recordings/<name>.json.
// Usage: node scripts/record.mjs <board url> <name>
import { chromium } from 'playwright';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [url, name = 'run'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!url) throw new Error('usage: node scripts/record.mjs <board url> <name>');
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const outDir = join(root, 'recordings');
mkdirSync(outDir, { recursive: true });

const overlay = () => {
  const t0 = performance.timeOrigin;
  const css = `#rec-ov{position:fixed;top:8px;right:8px;z-index:99999;font:12px/1.35 ui-monospace,monospace;background:#111d;color:#fff;padding:6px 9px;border-radius:6px;pointer-events:none;white-space:pre}
  #rec-cap{position:fixed;left:50%;transform:translateX(-50%);bottom:56px;z-index:99999;font:15px/1.4 system-ui;background:#1d4ed8;color:#fff;padding:8px 14px;border-radius:8px;pointer-events:none;max-width:85%;text-align:center}
  #rec-cur{position:fixed;z-index:100000;width:18px;height:18px;margin:-9px 0 0 -9px;border:3px solid #e11d48;border-radius:50%;background:#e11d4833;pointer-events:none;transition:transform .1s}
  #rec-cur.down{transform:scale(.6);background:#e11d48}
  .rec-hl{outline:3px solid #f59e0b !important;outline-offset:-3px}`;
  addEventListener('DOMContentLoaded', () => {
    const s = document.createElement('style'); s.textContent = css; document.head.append(s);
    const ov = document.createElement('div'); ov.id = 'rec-ov'; document.body.append(ov);
    const cur = document.createElement('div'); cur.id = 'rec-cur'; cur.style.left = '-50px'; document.body.append(cur);
    const sha = document.querySelector('meta[name="build"]')?.content ?? '?';
    const tick = () => {
      const s = Math.floor((Date.now() - window.__recStart) / 1000);
      ov.textContent = `rec ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}\n${location.origin}\nbuild ${sha.slice(0, 12)}`;
    };
    setInterval(tick, 200); tick();
    addEventListener('mousemove', (e) => { cur.style.left = e.clientX + 'px'; cur.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', () => cur.classList.add('down'), true);
    addEventListener('mouseup', () => cur.classList.remove('down'), true);
  });
  window.__caption = (text) => {
    let c = document.getElementById('rec-cap');
    if (!text) return c?.remove();
    if (!c) { c = document.createElement('div'); c.id = 'rec-cap'; document.body.append(c); }
    c.textContent = text;
  };
  void t0;
};

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: outDir, size: { width: 1280, height: 800 } },
  locale: 'pl-PL',
  timezoneId: 'Europe/Warsaw',
});
const recStart = Date.now(); // the video's clock starts with the page
await context.addInitScript(`window.__recStart = ${recStart};`);
await context.addInitScript(overlay);
const page = await context.newPage();
const at = () => {
  const s = Math.floor((Date.now() - recStart) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const events = [];
const note = (event, extra = {}) => { const e = { event, at: at(), utc: new Date().toISOString(), ...extra }; events.push(e); console.log(JSON.stringify(e)); };
const caption = (t) => page.evaluate((t) => window.__caption(t), t);
const acks = [];
page.on('response', async (res) => {
  if (res.url().includes('/ack?')) { try { acks.push({ ...(await res.json()), status: res.status(), at: at() }); } catch {} }
});
const topId = () => page.evaluate(() => document.querySelector('[data-testid="incident-row"]')?.dataset.id);
const glide = async (x, y, steps = 25) => { await page.mouse.move(x, y, { steps }); };

try {
  // open-board
  await page.goto(url);
  note('open-board: page requested');
  await page.waitForSelector('[data-testid="incident-row"]', { timeout: 20000 });
  const sha = await page.getAttribute('meta[name="build"]', 'content');
  note('open-board: incidents on screen, loader gone', { rows: await page.locator('[data-testid="incident-row"]').count(), sha });
  await caption('open-board: tonight\'s incidents, newest first. Build sha in the footer.');
  await page.locator('[data-testid="build-sha"]').evaluate((n) => n.classList.add('rec-hl'));
  await page.waitForTimeout(3500);
  await page.locator('[data-testid="build-sha"]').evaluate((n) => n.classList.remove('rec-hl'));

  // watch-board: no reload; wait for a new incident to land at the top
  await caption('watch-board: no reload — waiting for a new incident to arrive at the top…');
  const first = await topId();
  await page.waitForFunction((id) => document.querySelector('[data-testid="incident-row"]')?.dataset.id !== id, first, { timeout: 30000, polling: 100 });
  const landed = await topId();
  await page.locator(`[data-testid="incident-row"][data-id="${landed}"]`).evaluate((n) => n.classList.add('rec-hl'));
  note('watch-board: new incident at top without reload', { previousTop: first, newTop: landed });
  await caption(`watch-board: ${landed} arrived at the top without a reload.`);
  await page.waitForTimeout(3500);

  // ack-incident after SCHED-4515, clicked like a person: aim at a row, click that spot while the board goes on
  // moving. A row only opens its panel; the panel names the incident; Ack lives in the panel.
  await page.evaluate(() => document.querySelectorAll('.rec-hl').forEach((n) => n.classList.remove('rec-hl')));
  const meantRow = page.locator('[data-testid="incident-row"]').nth(1);
  const meant = await meantRow.getAttribute('data-id');
  await meantRow.evaluate((n) => n.classList.add('rec-hl'));
  await caption(`ack-incident: on-call reads ${meant} and goes for its row.`);
  const box = await meantRow.boundingBox();
  const px = box.x + box.width * 0.45, py = box.y + box.height / 2;
  await glide(px, py);
  note('ack-incident: pointer on the row on-call means', { meant });
  let ackCount = acks.length;
  await page.waitForFunction((id) => document.querySelector('[data-testid="incident-row"]')?.dataset.id !== id,
    await topId(), { timeout: 30000, polling: 'raf' });
  const landed2 = await topId();
  await page.mouse.click(px, py); // the same spot on screen, as a person's hand would
  note('ack-incident: new incident landed as the click went in', { meant, landed: landed2 });
  await page.waitForSelector('[data-testid="incident-panel"]:visible', { timeout: 5000 });
  const firstPanel = (await page.textContent('[data-testid="incident-panel"] h2')).trim();
  const ackedByWrongClick = acks.length - ackCount;
  note('ack-incident: panel opened', { meant, panelNames: firstPanel, acksSent: ackedByWrongClick });
  if (firstPanel !== meant) {
    await caption(`The row moved as they clicked: the panel names ${firstPanel}, not ${meant}. Nothing was acked.`);
    await page.waitForTimeout(4000);
    await caption(`On-call reads the panel and picks ${meant} again.`);
    const again = await page.locator(`[data-testid="incident-row"][data-id="${meant}"]`).boundingBox();
    await glide(again.x + again.width * 0.45, again.y + again.height / 2, 20);
    await page.mouse.click(again.x + again.width * 0.45, again.y + again.height / 2);
    await page.waitForTimeout(300);
  }
  const panelNow = (await page.textContent('[data-testid="incident-panel"] h2')).trim();
  note('ack-incident: panel names', { meant, panelNames: panelNow });
  await caption(`The panel names ${panelNow}. Ack is in the panel.`);
  await page.waitForTimeout(2500);
  const ab = await page.locator('[data-testid="panel-ack"]').boundingBox();
  await glide(ab.x + ab.width / 2, ab.y + ab.height / 2, 20);
  ackCount = acks.length;
  const ackAt = at();
  await page.mouse.click(ab.x + ab.width / 2, ab.y + ab.height / 2);
  await page.waitForSelector(`[data-testid="incident-row"][data-id="${meant}"] [data-testid="acked"]`, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(300);
  const reply = acks.slice(ackCount)[0] ?? null;
  note('ack-incident: panel Ack', { expected: meant, got: reply?.id, at: ackAt, ackedAt: reply?.ackedAt, receipt: reply?.receipt ? reply.receipt.slice(0, 12) + '…' : null });
  await page.evaluate(() => document.querySelectorAll('.rec-hl').forEach((n) => n.classList.remove('rec-hl')));
  if (reply?.id) await page.locator(`[data-testid="incident-row"][data-id="${reply.id}"]`).evaluate((n) => n.classList.add('rec-hl'));
  await caption(reply?.id === meant
    ? `expected ${meant}, got ${reply.id}: the ack went to the incident on-call meant.`
    : `expected ${meant}, got ${reply?.id ?? 'no ack'}.`);
  await page.waitForTimeout(6000);
  await caption('');
  await page.waitForTimeout(800);

  writeFileSync(join(outDir, `${name}.json`), JSON.stringify({
    url, sha, recStartUtc: new Date(recStart).toISOString(), events, acks,
    ack: { expected: meant, got: reply?.id ?? null, at: ackAt, ackedAt: reply?.ackedAt ?? null, receipt: reply?.receipt ?? null,
      wrongPanel: firstPanel !== meant ? firstPanel : null, acksFromWrongClick: ackedByWrongClick, landed: landed2 },
  }, null, 2));
} finally {
  const video = page.video();
  await context.close();
  await browser.close();
  if (video) {
    const path = await video.path();
    renameSync(path, join(outDir, `${name}.webm`));
    console.log(`video: recordings/${name}.webm`);
  }
}
