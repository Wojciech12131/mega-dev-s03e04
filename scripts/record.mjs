// Records the board in use (open-board, watch-board, ack-incident) against a real URL, with Playwright video.
// The recording script alone adds an overlay: elapsed mm:ss on the video's own clock, the page origin, the build
// sha, a visible pointer, and captions. Event times, the ack receipt and the sha go to recordings/<name>.json.
// Usage: node scripts/record.mjs <board url> <name> [--no-ack]
import { chromium } from 'playwright';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [url, name = 'run'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const noAck = process.argv.includes('--no-ack');
if (!url) throw new Error('usage: node scripts/record.mjs <board url> <name> [--no-ack]');
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
  viewport: { width: 1100, height: 700 },
  recordVideo: { dir: outDir, size: { width: 1100, height: 700 } },
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

  // ack-incident
  let receipt = null;
  if (!noAck) {
    const target = page.locator('[data-testid="incident-row"]').nth(2);
    const id = await target.getAttribute('data-id');
    await caption(`ack-incident: on-call takes ${id}.`);
    const box = await target.locator('[data-testid="ack"]').boundingBox();
    await glide(box.x + box.width / 2, box.y + box.height / 2);
    // aim and click on the row that is under the pointer right now
    const under = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid="incident-row"]')?.dataset.id, [box.x + box.width / 2, box.y + box.height / 2]);
    if (under !== id) note('ack-incident: target moved before click', { target: id, under });
    await page.locator(`[data-testid="incident-row"][data-id="${id}"] [data-testid="ack"]`).click();
    note('ack-incident: Ack clicked', { id });
    await page.waitForSelector(`[data-testid="incident-row"][data-id="${id}"] [data-testid="acked"]`, { timeout: 10000 });
    const reply = acks.find((a) => a.id === id);
    receipt = reply?.receipt ?? null;
    note('ack-incident: row marked acked', { id, ackedAt: reply?.ackedAt, receipt: receipt ? receipt.slice(0, 12) + '…' : null });
    await page.locator(`[data-testid="incident-row"][data-id="${id}"]`).evaluate((n) => n.classList.add('rec-hl'));
    await caption(`ack-incident: ${id} acked (✓ acked) — the API answered with a receipt.`);
    await page.waitForTimeout(4500);
  }

  // the product question: the pointer stays still over an Ack; a new incident lands; the Ack under it changes owner
  await caption('Watch the pointer: it stays still over the top row\'s Ack while the board refreshes.');
  const top = await topId();
  const box = await page.locator(`[data-testid="incident-row"][data-id="${top}"] [data-testid="ack"]`).boundingBox();
  const px = box.x + box.width / 2, py = box.y + box.height / 2;
  await glide(px, py);
  note('shift: pointer resting on Ack of top row', { aimedAt: top });
  await page.waitForFunction((id) => document.querySelector('[data-testid="incident-row"]')?.dataset.id !== id, top, { timeout: 30000, polling: 50 });
  const now = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid="incident-row"]')?.dataset.id, [px, py]);
  note('shift: new incident landed; the Ack under the still pointer now belongs to another incident', { aimedAt: top, underPointer: now });
  await caption(`Pointer did not move: it aimed at ${top}'s Ack, now it is on ${now}'s Ack. A click here acks the wrong incident.`);
  await page.waitForTimeout(6000);
  await caption('');
  await page.waitForTimeout(800);

  writeFileSync(join(outDir, `${name}.json`), JSON.stringify({ url, sha, recStartUtc: new Date(recStart).toISOString(), events, acks, receipt }, null, 2));
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
