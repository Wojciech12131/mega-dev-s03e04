import { fetchIncidents, ack } from './api.js';
import { formatLocal } from './time.js';

const REFRESH_MS = 2000; // R4 / SCHED-4513

const list = document.querySelector('[data-testid="incident-list"]');
const loader = document.querySelector('[data-testid="loader"]');
const empty = document.querySelector('[data-testid="empty"]');
const status = document.querySelector('#status');

const rows = new Map(); // incident id -> <li>, kept across refreshes so rows are updated in place, never rebuilt
const acked = new Set(); // incident ids acked from this board
let loaded = false;

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function severityClass(sev) {
  return /^sev\d$/.test(sev) ? sev : 'sev-unknown';
}

function ackedMark(reply) {
  const at = reply?.ackedAt ? formatLocal(reply.ackedAt) : '';
  return el('span', { 'data-testid': 'acked', class: 'acked', title: at }, '✓ acked');
}

// R2 / SCHED-4511: Ack sends api.ack(id); the row is marked only after the ack is confirmed.
async function onAck(id, button) {
  button.disabled = true;
  button.textContent = 'Acking…';
  try {
    const reply = await ack(id);
    acked.add(id);
    button.replaceWith(ackedMark(reply));
  } catch (err) {
    button.disabled = false;
    button.textContent = 'Ack';
    button.title = `Ack failed: ${err.message}`;
    setStatus(`Ack ${id} failed — try again`, true);
  }
}

function fill(li, i) {
  li.className = `row ${severityClass(i.severity)}`;
  li.querySelector('.sev').textContent = i.severity;
  li.querySelector('.what').textContent = `${i.service} · ${i.region} · ${i.summary}`;
  const time = li.querySelector('time');
  time.setAttribute('datetime', i.openedAt); // full UTC value stays in the attribute (SCHED-4514)
  time.title = i.openedAt;
  time.textContent = formatLocal(i.openedAt);
}

function createRow(i) {
  const li = el('li', { 'data-testid': 'incident-row', 'data-id': i.id });
  li.append(el('span', { class: 'id' }, i.id), el('span', { class: 'sev' }), el('span', { class: 'what' }), el('time'));
  const action = el('span', { class: 'action' });
  if (acked.has(i.id)) action.append(ackedMark());
  else {
    const button = el('button', { type: 'button', 'data-testid': 'ack' }, 'Ack');
    button.addEventListener('click', () => onAck(i.id, button));
    action.append(button);
  }
  li.append(action);
  fill(li, i);
  return li;
}

// R1 / SCHED-4511: newest first; new incidents go in at the top; existing rows keep their DOM node.
function update(incidents) {
  const sorted = [...incidents].sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt));
  sorted.forEach((i, index) => {
    let li = rows.get(i.id);
    if (li) fill(li, i);
    else rows.set(i.id, (li = createRow(i)));
    if (list.children[index] !== li) list.insertBefore(li, list.children[index] ?? null);
  });
  const has = list.children.length > 0;
  list.hidden = !has;
  empty.hidden = has;
}

function setStatus(text, bad = false) {
  status.textContent = text;
  status.classList.toggle('bad', bad);
}

// R3 / SCHED-4512 + R4 / SCHED-4513: loader until the first answer, then refresh 2 s after each answer
// (chained, so requests never overlap).
async function tick() {
  try {
    const page = await fetchIncidents();
    update(page.incidents ?? []);
    if (!loaded) {
      loaded = true;
      loader.remove();
    }
    setStatus(`Updated ${formatLocal(page.updatedAt ?? new Date().toISOString())}`);
  } catch (err) {
    setStatus(`Can't reach the incident API (${err.message}) — retrying`, true);
  } finally {
    setTimeout(tick, REFRESH_MS);
  }
}

tick();
