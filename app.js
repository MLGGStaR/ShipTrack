// app.js — the board: storage, add/refresh flows and rendering. Logic lives in carriers.js, providers.js, format.js.

import { CARRIERS, detectCarrier, extractNumbers, trackingUrl, universalLinks } from './carriers.js';
import { PROVIDERS, fetchTracking, testKey, parseSetupHash } from './providers.js';
import { statusLabel, arrivalCopy, statusTone, relativeTime, eventTime, milestoneStep, parseTime } from './format.js';

const STORAGE_KEY = 'shiptrack.v1';
const STORES = ['Shop', 'eBay', 'Amazon', 'AliExpress', 'Shein', 'Temu', 'Noon', 'Shop & Ship', 'Etsy', 'Other'];
const AUTO_REFRESH_MS = 20 * 60 * 1000;
const STATUS_PRIORITY = { out_for_delivery: 0, available_for_pickup: 1, failed_attempt: 2, exception: 3, in_transit: 4, info_received: 5, pending: 6, expired: 7 };
const STEP_NAMES = ['Label', 'Transit', 'Out', 'Delivered'];
const FILTERS = ['active', 'delivered', 'all'];

// Provider courier codes -> local carrier keys (for deep links and the carrier label).
const PROVIDER_CARRIER = {
  'us-post': 'usps', 'ae-post': 'emirates-post', 'cn-post': 'china-post', 'gb-post': 'royal-mail', 'de-post': 'deutsche-post',
  'jp-post': 'japan-post', 'ca-post': 'canada-post', 'au-post': 'australia-post', 'fr-post': 'la-poste', 'es-post': 'correos',
  'sg-post': 'singapore-post', 'hk-post': 'hongkong-post', 'nl-post': 'postnl', 'sa-post': 'saudi-post', 'in-post': 'india-post',
  'kr-post': 'korea-post', 'it-post': 'poste-italiane', 'ch-post': 'swiss-post', 'tr-post': 'turkish-post', 'my-post': 'pos-malaysia',
  'th-post': 'thailand-post', 'dhl-express': 'dhl', 'dhl-ecommerce': 'dhl', 'dhl-parcel': 'dhl', 'amazon-logistics': 'amazon',
  'yun-express': 'yunexpress', 'emirates-post': 'emirates-post', 'royal-mail': 'royal-mail', 'china-post': 'china-post',
};

const state = {
  shipments: [],
  settings: { provider: '', apiKey: '', ship24Plan: 'per-shipment', theme: 'auto' },
  lastRefresh: null,
  filter: 'active',
  expanded: new Set(),
  editing: null, // { id, item, store, notes, carrier }
  busy: new Set(),
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

// --- storage -----------------------------------------------------------------

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    state.shipments = Array.isArray(data.shipments) ? data.shipments : [];
    Object.assign(state.settings, data.settings || {});
    state.lastRefresh = data.lastRefresh || null;
  } catch (e) {
    console.warn('Saved data could not be read', e);
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ shipments: state.shipments, settings: state.settings, lastRefresh: state.lastRefresh }));
  } catch (e) {
    toast('Could not save. Storage is full or blocked.');
  }
}

// --- helpers -----------------------------------------------------------------

const providerReady = () => Boolean(PROVIDERS[state.settings.provider] && state.settings.apiKey);
const isDelivered = (s) => Boolean(s.track && s.track.status === 'delivered');
const isActive = (s) => !s.archived && !isDelivered(s);

function carrierFromProviderCode(code) {
  if (!code) return null;
  const c = String(code).toLowerCase();
  if (CARRIERS[c]) return c;
  if (PROVIDER_CARRIER[c]) return PROVIDER_CARRIER[c];
  const byTm = Object.keys(CARRIERS).find((k) => CARRIERS[k].tm === c);
  return byTm || null;
}

function carrierLabel(s) {
  if (s.carrier && CARRIERS[s.carrier]) return CARRIERS[s.carrier].name;
  if (s.track && s.track.courier) return s.track.courier;
  return 'Carrier unknown';
}

function newShipment(number) {
  const hit = detectCarrier(number);
  return {
    id: uid(), number, carrier: hit ? hit.key : null, carrierPicked: false,
    item: '', store: '', notes: '', createdAt: new Date().toISOString(), archived: false,
    track: null, error: null, ref: {}, lastFetch: null,
  };
}

function etaDate(s) {
  const eta = s.track && s.track.eta;
  if (!eta) return null;
  const d = parseTime(eta.date) || parseTime(eta.from) || parseTime(eta.to);
  return d ? d.getTime() : null;
}

function sortForBoard(list) {
  const editingId = state.editing && state.editing.id;
  return list.slice().sort((a, b) => {
    // the card being edited stays put at the top, and parcels not fetched yet wait there too
    if ((a.id === editingId) !== (b.id === editingId)) return a.id === editingId ? -1 : 1;
    if (a.archived !== b.archived) return a.archived ? 1 : -1;
    if (!a.track !== !b.track) return a.track ? 1 : -1;
    const da = isDelivered(a), db = isDelivered(b);
    if (da !== db) return da ? 1 : -1;
    if (da && db) {
      const ta = parseTime(a.track.deliveredAt), tb = parseTime(b.track.deliveredAt);
      return (tb ? tb.getTime() : 0) - (ta ? ta.getTime() : 0);
    }
    const pa = a.track ? STATUS_PRIORITY[a.track.status] ?? 8 : 9;
    const pb = b.track ? STATUS_PRIORITY[b.track.status] ?? 8 : 9;
    if (pa !== pb) return pa - pb;
    const ea = etaDate(a), eb = etaDate(b);
    if (ea !== eb) return (ea ?? Infinity) - (eb ?? Infinity);
    return (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0);
  });
}

function visibleShipments() {
  const all = sortForBoard(state.shipments);
  if (state.filter === 'active') return all.filter(isActive);
  if (state.filter === 'delivered') return all.filter((s) => isDelivered(s) && !s.archived);
  return all;
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

function showAddHint(msg, kind = '') {
  const el = $('#addHint');
  el.textContent = msg;
  el.className = `hint ${kind}`;
  el.hidden = !msg;
}

function setFilter(filter, { pushUrl = true } = {}) {
  state.filter = FILTERS.includes(filter) ? filter : 'active';
  if (pushUrl) {
    const url = new URL(location.href);
    if (state.filter === 'active') url.searchParams.delete('filter'); else url.searchParams.set('filter', state.filter);
    history.replaceState(null, '', url.pathname + url.search);
  }
  render();
}

// --- rendering ---------------------------------------------------------------

function render() {
  renderSummary();
  renderFilters();
  renderList();
}

function renderSummary() {
  const active = state.shipments.filter(isActive);
  const count = (fn) => active.filter(fn).length;
  const items = [];
  const today = count((s) => s.track && (s.track.status === 'out_for_delivery' || arrivalCopy(s.track).headline === 'Arriving today'));
  const pickup = count((s) => s.track && s.track.status === 'available_for_pickup');
  const transit = count((s) => s.track && (s.track.status === 'in_transit' || s.track.status === 'info_received') && arrivalCopy(s.track).headline !== 'Arriving today');
  const trouble = count((s) => s.track && ['failed_attempt', 'exception'].includes(s.track.status));
  const waiting = count((s) => !s.track || s.track.status === 'pending');
  if (today) items.push({ tone: 'live', text: `<strong>${today}</strong> arriving today` });
  if (pickup) items.push({ tone: 'live', text: `<strong>${pickup}</strong> ready for pickup` });
  if (trouble) items.push({ tone: 'warn', text: `<strong>${trouble}</strong> need${trouble === 1 ? 's' : ''} attention` });
  if (transit) items.push({ tone: '', text: `<strong>${transit}</strong> in transit` });
  if (waiting) items.push({ tone: '', text: `<strong>${waiting}</strong> waiting for a scan` });
  if (!items.length) items.push({ tone: 'done', text: active.length ? `<strong>${active.length}</strong> on the board` : 'Nothing on the way' });
  $('#summary').innerHTML = items.map((i) => `<li><span class="dot ${i.tone}"></span><span>${i.text}</span></li>`).join('');
  $('#summaryLine').innerHTML = items.slice(0, 3).map((i) => i.text).join(' <span class="muted">·</span> ');
}

function renderFilters() {
  const counts = {
    active: state.shipments.filter(isActive).length,
    delivered: state.shipments.filter((s) => isDelivered(s) && !s.archived).length,
    all: state.shipments.length,
  };
  for (const el of $$('[data-count]')) el.textContent = counts[el.dataset.count];
  for (const el of $$('[data-filter]')) {
    const active = el.dataset.filter === state.filter;
    el.classList.toggle('is-active', active);
    el.setAttribute('aria-pressed', String(active));
  }
  for (const el of $$('[data-action="refresh-all"]')) el.hidden = !providerReady() || !counts.active;
  $('#lastRefresh').textContent = providerReady() && state.lastRefresh ? `Refreshed ${relativeTime(state.lastRefresh)}` : '';
}

function renderList() {
  const list = $('#list');
  const focus = document.activeElement && list.contains(document.activeElement) ? { id: document.activeElement.id, start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd } : null;
  const items = visibleShipments();

  if (!state.shipments.length) {
    list.innerHTML = `<div class="empty">
      <div class="glyph">${icon('package')}</div>
      <h2>No parcels yet</h2>
      <p>Paste a tracking number or the link from a shipping email. The carrier is worked out for you.</p>
      <div class="carriers">${['USPS', 'UPS', 'FedEx', 'DHL', 'Aramex', 'Shop & Ship', 'Emirates Post', 'Amazon', 'China Post', 'Cainiao', '1,500+ more'].map((c) => `<span>${esc(c)}</span>`).join('')}</div>
    </div>`;
    return;
  }
  if (!items.length) {
    const msg = state.filter === 'active' ? 'Nothing on the way right now.' : state.filter === 'delivered' ? 'Nothing delivered yet.' : 'Nothing here.';
    list.innerHTML = `<div class="empty quiet"><p>${msg}</p></div>`;
    return;
  }

  list.innerHTML = items.map((s, i) => cardHTML(s, i)).join('');

  if (focus && focus.id) {
    const el = document.getElementById(focus.id);
    if (el) {
      el.focus({ preventScroll: true });
      if (typeof focus.start === 'number' && el.setSelectionRange) { try { el.setSelectionRange(focus.start, focus.end); } catch { /* not a text field */ } }
    }
  }
}

function cardHTML(s, index) {
  const t = s.track;
  const copy = arrivalCopy(t);
  const tone = statusTone(t);
  const ev = t && t.events && t.events[0];
  const editing = state.editing && state.editing.id === s.id;
  const expanded = state.expanded.has(s.id);
  const busy = state.busy.has(s.id);
  const linkName = s.carrier && CARRIERS[s.carrier] ? CARRIERS[s.carrier].name : '17TRACK';
  const pulse = t && (t.status === 'out_for_delivery' || t.status === 'available_for_pickup');
  const chipText = t ? statusLabel(t.status) : busy ? 'Fetching…' : providerReady() ? 'Not fetched' : 'Not tracked';

  let lead;
  if (t) {
    lead = `<div class="arrival"><h3>${esc(copy.headline)}</h3>${copy.detail ? `<p>${esc(copy.detail)}</p>` : ''}</div>`;
  } else if (busy) {
    lead = '<div class="skeleton" aria-label="Fetching status"><span></span><span></span></div>';
  } else if (!providerReady()) {
    lead = '<div class="arrival"><h3>Not tracked yet</h3><p>Live status needs a free tracking key. <button type="button" class="link" data-action="open-settings">Set it up</button></p></div>';
  } else {
    lead = '<div class="arrival"><h3>Not fetched yet</h3><p><button type="button" class="link" data-action="refresh">Fetch status</button></p></div>';
  }

  return `<article class="card tone-${tone}${s.archived ? ' is-archived' : ''}" data-id="${s.id}" style="--i:${Math.min(index, 10)}">
    <div class="card-top">
      <span class="chip${pulse ? ' pulse' : ''}"><span class="dot"></span>${esc(chipText)}</span>
      <div class="card-meta"><span class="carrier">${esc(carrierLabel(s))}</span>${s.store ? `<span class="sep">·</span><span>${esc(s.store)}</span>` : ''}</div>
    </div>
    <h2 class="card-title">${s.item ? esc(s.item) : `<span class="untitled">Untitled parcel</span>${editing ? '' : '<button type="button" class="link" data-action="edit">Add a name</button>'}`}</h2>
    ${lead}
    ${t ? railHTML(s, t) : ''}
    ${ev ? `<div class="latest">${icon('pin')}<div class="text">${esc(ev.text)}${ev.location ? ` <span class="when">· ${esc(ev.location)}</span>` : ''}${ev.time ? ` <span class="when">· ${esc(eventTime(ev.time))}</span>` : ''}</div></div>` : ''}
    ${s.error ? `<div class="error-line">${icon('alert')}<span>${esc(s.error)}</span></div>` : ''}
    ${s.notes && !editing ? `<p class="notes">${esc(s.notes)}</p>` : ''}
    ${expanded && t ? eventsHTML(t) : ''}
    ${editing ? detailsHTML(s) : ''}
    <div class="card-foot">
      <button type="button" class="number-btn" data-action="copy" title="Copy tracking number">${esc(s.number)}${icon('copy')}</button>
      <div class="actions">
        ${t ? `<button type="button" class="btn-ghost" data-action="toggle-events" aria-expanded="${expanded}">${icon('list')}${expanded ? 'Hide trail' : `Trail${t.events.length ? ` (${t.events.length})` : ''}`}</button>` : ''}
        <a class="btn-ghost" href="${esc(trackingUrl(s.carrier, s.number))}" target="_blank" rel="noopener">${icon('out')}${esc(linkName)}</a>
        ${providerReady() && !isDelivered(s) ? `<button type="button" class="btn-ghost" data-action="refresh"${busy ? ' disabled' : ''}>${icon('refresh')}Refresh</button>` : ''}
        ${editing ? '' : `<button type="button" class="btn-ghost" data-action="edit">${icon('edit')}${s.item || s.notes || s.store ? 'Edit' : 'Details'}</button>`}
        ${isDelivered(s) || s.archived ? `<button type="button" class="btn-ghost" data-action="${s.archived ? 'unarchive' : 'archive'}">${icon('archive')}${s.archived ? 'Unarchive' : 'Archive'}</button>` : ''}
      </div>
    </div>
  </article>`;
}

function railHTML(s, t) {
  const { step, stalled } = milestoneStep(t.status);
  const p = step < 0 ? 0 : step / 3;
  const origin = t.origin || (s.carrier === 'usps' ? 'US' : null);
  return `<div class="rail${stalled ? ' stalled' : ''}" role="img" aria-label="${esc(statusLabel(t.status))}, ${esc(origin || 'origin')} to ${esc(t.destination || 'destination')}">
    <span class="end">${esc(origin || '—')}</span>
    <div class="track">
      <div class="line"></div>
      <div class="fill" style="--p:${p}"></div>
      ${STEP_NAMES.map((name, i) => `<div class="stop${i < step ? ' done' : ''}${i === step ? ' now' : ''}"><span class="pip"></span><span>${name}</span></div>`).join('')}
    </div>
    <span class="end">${esc(t.destination || '—')}</span>
  </div>`;
}

function eventsHTML(t) {
  if (!t.events.length) return '<ul class="events"><li><span class="pip"></span><div class="ev-text muted">No events from the carrier yet.</div></li></ul>';
  const milestones = new Set(['delivered', 'out_for_delivery', 'available_for_pickup', 'failed_attempt', 'exception']);
  return `<ul class="events">${t.events.map((e) => `<li${milestones.has(e.milestone) ? ' class="is-milestone"' : ''}>
      <span class="pip"></span>
      <div><div class="ev-text">${esc(e.text)}</div><div class="ev-meta">${esc([eventTime(e.time), e.location].filter(Boolean).join(' · '))}</div></div>
    </li>`).join('')}</ul>`;
}

function detailsHTML(s) {
  const d = state.editing;
  const detected = detectCarrier(s.number);
  const options = Object.keys(CARRIERS)
    .filter((k) => k !== 'intl-post')
    .sort((a, b) => CARRIERS[a].name.localeCompare(CARRIERS[b].name))
    .map((k) => `<option value="${k}"${d.carrier === k ? ' selected' : ''}>${esc(CARRIERS[k].name)}</option>`)
    .join('');
  return `<form class="details" data-id="${s.id}">
    <label>What is it?<input id="f-item-${s.id}" name="item" data-field="item" value="${esc(d.item)}" placeholder="Blue Yeti microphone…" maxlength="120" autocomplete="off"></label>
    <label>Store<input id="f-store-${s.id}" name="store" data-field="store" list="stores" value="${esc(d.store)}" placeholder="eBay…" maxlength="40" autocomplete="off"></label>
    <label>Carrier<select id="f-carrier-${s.id}" name="carrier" data-field="carrier"><option value=""${d.carrier ? '' : ' selected'}>Auto${detected ? ` (${esc(detected.name)})` : ''}</option>${options}</select></label>
    <label class="wide">Notes<textarea id="f-notes-${s.id}" name="notes" data-field="notes" rows="2" placeholder="Order number, seller, anything to remember…">${esc(d.notes)}</textarea></label>
    <div class="details-actions">
      <button type="submit" class="btn btn-primary btn-sm">Save details</button>
      <button type="button" class="btn-ghost" data-action="cancel">Cancel</button>
      <span style="flex:1"></span>
      <button type="button" class="btn-ghost danger" data-action="delete">Delete parcel</button>
    </div>
  </form>`;
}

// --- actions -----------------------------------------------------------------

function findShipment(el) {
  const card = el.closest('[data-id]');
  return card ? state.shipments.find((s) => s.id === card.dataset.id) : null;
}

async function addFromInput(text) {
  const numbers = extractNumbers(text);
  if (!numbers.length) {
    showAddHint('No tracking number found in that. Paste the number itself or the carrier link.', 'is-error');
    return;
  }
  const existing = new Set(state.shipments.map((s) => s.number));
  const fresh = numbers.filter((n) => !existing.has(n));
  if (!fresh.length) {
    showAddHint(numbers.length === 1 ? 'That parcel is already on the board.' : 'Those parcels are already on the board.', 'is-error');
    return;
  }
  const created = fresh.map(newShipment);
  state.shipments.unshift(...created);
  state.editing = { id: created[0].id, item: '', store: '', notes: '', carrier: '' };
  $('#numberInput').value = '';
  showAddHint(created.length > 1 ? `Added ${created.length} parcels.` : '', 'is-ok');
  save();
  setFilter('active');
  const first = document.getElementById(`f-item-${created[0].id}`);
  if (first) first.focus({ preventScroll: false });
  if (providerReady()) {
    for (const s of created) { await refreshShipment(s, { silent: true }); await sleep(350); }
  }
}

async function refreshShipment(s, { silent = false } = {}) {
  if (!providerReady()) { if (!silent) openSettings(); return; }
  if (state.busy.has(s.id)) return;
  state.busy.add(s.id);
  render();
  try {
    const track = await fetchTracking(state.settings, s);
    s.track = track;
    s.ref = { ...(s.ref || {}), ...(track.ref || {}) };
    s.error = null;
    s.lastFetch = track.fetchedAt;
    if (!s.carrierPicked && track.courier) {
      const key = carrierFromProviderCode(track.courier);
      if (key) s.carrier = key;
    }
  } catch (e) {
    s.error = e.message || String(e);
    if (!silent) toast(s.error);
  } finally {
    state.busy.delete(s.id);
    save();
    render();
  }
}

let refreshingAll = false;
async function refreshAll({ force = false } = {}) {
  if (!providerReady() || refreshingAll) return;
  const stale = (s) => force || !s.lastFetch || Date.now() - Date.parse(s.lastFetch) > AUTO_REFRESH_MS;
  const targets = state.shipments.filter((s) => isActive(s) && stale(s));
  if (!targets.length) return;
  refreshingAll = true;
  try {
    for (const s of targets) { await refreshShipment(s, { silent: true }); await sleep(350); }
    state.lastRefresh = new Date().toISOString();
    save();
    render();
  } finally {
    refreshingAll = false;
  }
}

function startEdit(s) {
  state.editing = { id: s.id, item: s.item || '', store: s.store || '', notes: s.notes || '', carrier: s.carrierPicked ? s.carrier || '' : '' };
  render();
  const el = document.getElementById(`f-item-${s.id}`);
  if (el) el.focus();
}

function saveEdit(s) {
  const d = state.editing;
  if (!d || d.id !== s.id) return;
  s.item = d.item.trim();
  s.store = d.store.trim();
  s.notes = d.notes.trim();
  const before = s.carrier;
  if (d.carrier) { s.carrier = d.carrier; s.carrierPicked = true; }
  else if (s.carrierPicked) { s.carrierPicked = false; s.carrier = (detectCarrier(s.number) || {}).key || null; }
  state.editing = null;
  save();
  render();
  if (s.carrier !== before && providerReady()) {
    s.ref = {};
    s.track = null;
    refreshShipment(s, { silent: true });
  }
}

function deleteShipment(s) {
  if (!confirm(`Delete ${s.item || s.number} from the board?`)) return;
  state.shipments = state.shipments.filter((x) => x.id !== s.id);
  if (state.editing && state.editing.id === s.id) state.editing = null;
  state.expanded.delete(s.id);
  save();
  render();
  toast('Parcel deleted');
}

async function copyNumber(s) {
  try {
    await navigator.clipboard.writeText(s.number);
    toast('Tracking number copied');
  } catch {
    toast('Copy is blocked here. Select the number instead.');
  }
}

// --- settings ----------------------------------------------------------------

function applyTheme() {
  const t = state.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

function syncPlanUI() {
  const current = ($('input[name="plan"]:checked') || {}).value || 'per-shipment';
  for (const b of $$('[data-plan]')) b.classList.toggle('is-active', b.dataset.plan === current);
}

function openSettings() {
  const dlg = $('#settings');
  const s = state.settings;
  const radio = $(`input[name="provider"][value="${s.provider}"]`) || $('input[name="provider"][value=""]');
  radio.checked = true;
  $('#apiKey').value = s.apiKey || '';
  $('#apiKey').type = 'password';
  $('#toggleKey').textContent = 'Show';
  ($(`input[name="plan"][value="${s.ship24Plan}"]`) || $('input[name="plan"][value="per-shipment"]')).checked = true;
  $('#theme').value = s.theme || 'auto';
  $('#keyResult').textContent = '';
  $('#keyResult').className = 'hint';
  syncProviderUI();
  syncPlanUI();
  if (!dlg.open) dlg.showModal();
}

function syncProviderUI() {
  const provider = ($('input[name="provider"]:checked') || {}).value || '';
  const meta = PROVIDERS[provider];
  $('#keyRow').hidden = !meta;
  $('#planRow').hidden = provider !== 'ship24';
  if (meta) {
    $('#keyLink').href = meta.keyUrl;
    $('#keyLink').textContent = `Get a ${meta.name} key ↗`;
    $('#keyHint').textContent = meta.hint;
  }
}

function saveSettings() {
  const provider = ($('input[name="provider"]:checked') || {}).value || '';
  const wasReady = providerReady();
  state.settings.provider = PROVIDERS[provider] ? provider : '';
  state.settings.apiKey = $('#apiKey').value.trim();
  state.settings.ship24Plan = ($('input[name="plan"]:checked') || {}).value || 'per-shipment';
  state.settings.theme = $('#theme').value;
  applyTheme();
  save();
  render();
  toast('Settings saved');
  if (providerReady() && !wasReady) refreshAll({ force: true });
}

function exportData() {
  const payload = { app: 'ShipTrack', exportedAt: new Date().toISOString(), shipments: state.shipments, settings: { ...state.settings, apiKey: '' } };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `shiptrack-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    const incoming = Array.isArray(data.shipments) ? data.shipments : null;
    if (!incoming) throw new Error('no shipments');
    const have = new Set(state.shipments.map((s) => s.number));
    const added = incoming.filter((s) => s && s.number && !have.has(s.number));
    state.shipments.push(...added.map((s) => ({ ...newShipment(s.number), ...s, id: s.id && !state.shipments.some((x) => x.id === s.id) ? s.id : uid() })));
    if (data.settings) {
      const { apiKey, ...rest } = data.settings;
      Object.assign(state.settings, rest);
      if (apiKey && !state.settings.apiKey) state.settings.apiKey = apiKey;
    }
    applyTheme();
    save();
    render();
    toast(`Imported ${added.length} parcel${added.length === 1 ? '' : 's'}`);
  } catch {
    toast('That file is not a ShipTrack export.');
  }
}

function wipe() {
  if (!confirm('Delete every parcel, note and setting from this browser?')) return;
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
}

// --- wiring ------------------------------------------------------------------

function wire() {
  $('#stores').innerHTML = STORES.map((s) => `<option value="${esc(s)}">`).join('');

  const input = $('#numberInput');
  $('#addForm').addEventListener('submit', (e) => {
    e.preventDefault();
    addFromInput(input.value);
  });
  input.addEventListener('input', () => showAddHint(''));
  // A paste that contains a tracking number is submitted straight away; the paste itself is never blocked.
  input.addEventListener('paste', () => {
    setTimeout(() => { if (extractNumbers(input.value).length) addFromInput(input.value); }, 0);
  });

  for (const el of $$('[data-filter]')) el.addEventListener('click', () => setFilter(el.dataset.filter));
  for (const el of $$('[data-action="refresh-all"]')) el.addEventListener('click', () => refreshAll({ force: true }));
  for (const el of $$('[data-action="settings"]')) el.addEventListener('click', openSettings);

  const list = $('#list');
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || !list.contains(btn)) return;
    const s = findShipment(btn);
    switch (btn.dataset.action) {
      case 'open-settings': openSettings(); break;
      case 'toggle-events': if (state.expanded.has(s.id)) state.expanded.delete(s.id); else state.expanded.add(s.id); render(); break;
      case 'edit': startEdit(s); break;
      case 'cancel': state.editing = null; render(); break;
      case 'delete': deleteShipment(s); break;
      case 'archive': s.archived = true; save(); render(); toast('Archived'); break;
      case 'unarchive': s.archived = false; save(); render(); break;
      case 'refresh': refreshShipment(s); break;
      case 'copy': copyNumber(s); break;
      default: break;
    }
  });
  list.addEventListener('input', (e) => {
    const field = e.target.dataset.field;
    if (!field || !state.editing) return;
    state.editing[field] = e.target.value;
  });
  list.addEventListener('change', (e) => {
    if (e.target.dataset.field === 'carrier' && state.editing) state.editing.carrier = e.target.value;
  });
  list.addEventListener('submit', (e) => {
    const form = e.target.closest('form.details');
    if (!form) return;
    e.preventDefault();
    const s = state.shipments.find((x) => x.id === form.dataset.id);
    if (s) saveEdit(s);
  });
  list.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.editing) { state.editing = null; render(); }
  });

  // settings dialog
  const dlg = $('#settings');
  $('#settingsForm').addEventListener('submit', (e) => { e.preventDefault(); saveSettings(); dlg.close(); });
  $('[data-action="close"]', dlg).addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  for (const r of $$('input[name="provider"]')) r.addEventListener('change', syncProviderUI);
  for (const b of $$('[data-plan]')) b.addEventListener('click', () => { $(`input[name="plan"][value="${b.dataset.plan}"]`).checked = true; syncPlanUI(); });
  $('#toggleKey').addEventListener('click', () => {
    const inp = $('#apiKey');
    inp.type = inp.type === 'password' ? 'text' : 'password';
    $('#toggleKey').textContent = inp.type === 'password' ? 'Show' : 'Hide';
  });
  $('#testKey').addEventListener('click', async () => {
    const provider = ($('input[name="provider"]:checked') || {}).value || '';
    const out = $('#keyResult');
    const btn = $('#testKey');
    out.textContent = 'Testing…';
    out.className = 'hint';
    btn.disabled = true;
    const r = await testKey({ provider, apiKey: $('#apiKey').value.trim() });
    btn.disabled = false;
    out.textContent = r.message;
    out.className = `hint ${r.ok ? 'is-ok' : 'is-error'}`;
  });
  $('#exportBtn').addEventListener('click', exportData);
  $('#importFile').addEventListener('change', (e) => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; });
  $('#wipeBtn').addEventListener('click', wipe);

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshAll(); });
  setInterval(() => renderFilters(), 60 * 1000);
}

function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline copy is optional */ });
}

// A setup link (#provider=...&key=...) stores the key on this device once, then disappears from the URL.
function applySetupLink() {
  const setup = parseSetupHash(location.hash);
  if (!setup) return false;
  Object.assign(state.settings, setup);
  save();
  history.replaceState(null, '', location.pathname + location.search);
  toast(`${PROVIDERS[setup.provider].name} key saved on this device`);
  return true;
}

load();
const fromLink = applySetupLink();
applyTheme();
wire();
setFilter(new URLSearchParams(location.search).get('filter') || 'active', { pushUrl: false });
registerSW();
refreshAll({ force: fromLink });
