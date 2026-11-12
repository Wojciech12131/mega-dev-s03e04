import { fetchIncidents, ack } from './api.js';
import { formatLocal } from './time.js';

const REFRESH_MS = 2000; // R4 / SCHED-4513

const list = document.querySelector('[data-testid="incident-list"]');
const loader = document.querySelector('[data-testid="loader"]');
const empty = document.querySelector('[data-testid="empty"]');
const status = document.querySelector('#status');
const panel = document.querySelector('[data-testid="incident-panel"]');
const panelHint = document.querySelector('#panel-hint');
const panelAck = document.querySelector('[data-testid="panel-ack"]');
const panelAcked = panel.querySelector('.panel-acked');

const rows = new Map(); // incident id -> <li>, kept across refreshes so rows are updated in place, never rebuilt
const incidents = new Map(); // incident id -> latest incident data
const acked = new Map(); // incident id -> ack reply, for incidents acked from this board
const acking = new Set(); // ack sent, answer not back yet
let selected = null; // the incident the panel names; it stays put while the list moves
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

// SCHED-4515 (product's decision after step 1): a row opens its incident panel; Ack lives in the panel, so a
// row that moves under the pointer can open the wrong panel, but can never ack the wrong incident.
function openPanel(id) {
  selected = id;
  for (const [rid, li] of rows) {
    const on = rid === id;
    li.classList.toggle('selected', on);
    li.setAttribute('aria-expanded', String(on));
  }
  renderPanel();
}

function closePanel() {
  if (!selected) return;
  rows.get(selected)?.classList.remove('selected');
  rows.get(selected)?.setAttribute('aria-expanded', 'false');
  selected = null;
  renderPanel();
}

function renderPanel() {
  const i = selected && incidents.get(selected);
  panel.hidden = !i;
  panelHint.hidden = Boolean(i);
  if (!i) return;
  panel.querySelector('.panel-id').textContent = i.id;
  panel.querySelector('.panel-what').textContent = `${i.service} · ${i.region} · ${i.summary}`;
  const sev = panel.querySelector('.panel-sev');
  sev.textContent = i.severity;
  sev.className = `panel-sev ${severityClass(i.severity)}`;
  const time = panel.querySelector('.panel-time');
  time.setAttribute('datetime', i.openedAt);
  time.title = i.openedAt;
  time.textContent = formatLocal(i.openedAt);
  const reply = acked.get(i.id);
  panelAck.hidden = Boolean(reply);
  panelAck.disabled = acking.has(i.id);
  panelAck.textContent = acking.has(i.id) ? `Acking ${i.id}…` : `Ack ${i.id}`;
  panelAcked.hidden = !reply;
  panelAcked.textContent = reply ? `✓ acked${reply.ackedAt ? ` at ${formatLocal(reply.ackedAt)}` : ''}` : '';
}

// R2 (changed): Ack sends api.ack(id) for the incident the panel names, and marks that row acked once confirmed.
async function ackSelected() {
  const id = selected;
  if (!id || acked.has(id) || acking.has(id)) return;
  acking.add(id);
  renderPanel();
  try {
    const reply = await ack(id);
    acked.set(id, reply);
    const mark = el('span', { 'data-testid': 'acked', class: 'acked', title: formatLocal(reply.ackedAt) }, '✓ acked');
    rows.get(id)?.querySelector('.action').replaceChildren(mark);
  } catch (err) {
    setStatus(`Ack ${id} failed — try again`, true);
    panelAck.title = `Ack failed: ${err.message}`;
  } finally {
    acking.delete(id);
    renderPanel();
  }
}

function fill(li, i) {
  li.className = `row ${severityClass(i.severity)}${i.id === selected ? ' selected' : ''}`;
  li.querySelector('.sev').textContent = i.severity;
  li.querySelector('.what').textContent = `${i.service} · ${i.region} · ${i.summary}`;
  const time = li.querySelector('time');
  time.setAttribute('datetime', i.openedAt); // full UTC value stays in the attribute (SCHED-4514)
  time.title = i.openedAt;
  time.textContent = formatLocal(i.openedAt);
}

function createRow(i) {
  const li = el('li', {
    'data-testid': 'incident-row', 'data-id': i.id, tabindex: '0', role: 'button',
    'aria-controls': 'incident-panel', 'aria-expanded': 'false', title: `Open ${i.id}`,
  });
  li.append(el('span', { class: 'id' }, i.id), el('span', { class: 'sev' }), el('span', { class: 'what' }), el('time'), el('span', { class: 'action' }));
  li.addEventListener('click', () => openPanel(i.id));
  li.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openPanel(i.id);
    }
  });
  fill(li, i);
  return li;
}

// R1 / SCHED-4511: newest first; new incidents go in at the top; existing rows keep their DOM node.
function update(list_) {
  for (const i of list_) incidents.set(i.id, i);
  const sorted = [...list_].sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt));
  sorted.forEach((i, index) => {
    let li = rows.get(i.id);
    if (li) fill(li, i);
    else rows.set(i.id, (li = createRow(i)));
    if (list.children[index] !== li) list.insertBefore(li, list.children[index] ?? null);
  });
  const has = list.children.length > 0;
  list.hidden = !has;
  empty.hidden = has;
  if (selected) renderPanel();
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

panelAck.addEventListener('click', ackSelected);
panel.querySelector('.panel-close').addEventListener('click', closePanel);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePanel();
});

tick();
