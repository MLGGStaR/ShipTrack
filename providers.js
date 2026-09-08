// providers.js — talks to the tracking APIs (called straight from the browser; both allow CORS)
// and normalises their answers into one Track shape:
// { provider, status, courier, origin, destination, eta:{date,from,to}|null, deliveredAt, signedBy,
//   events:[{time,text,location,milestone}] newest first, ref:{...}, fetchedAt }
// Unified statuses: pending, info_received, in_transit, out_for_delivery, failed_attempt,
// available_for_pickup, delivered, exception, expired.

import { CARRIERS } from './carriers.js';
import { parseTime } from './format.js';

export const PROVIDERS = {
  ship24: {
    name: 'Ship24',
    keyUrl: 'https://dashboard.ship24.com/integrations/api-keys',
    free: '10 shipments a month free, plus 100 extra in the first month',
    hint: 'Sign up at dashboard.ship24.com, choose the Free plan under Subscriptions, then create a key under Integrations → API keys.',
  },
  trackingmore: {
    name: 'TrackingMore',
    keyUrl: 'https://www.trackingmore.com/pricing',
    free: 'no free API: needs the Basic plan, about $9 a month',
    hint: 'The free plan has no API access. The Basic plan (14-day trial) gives API keys under Developer → API keys.',
  },
};

// One-time setup links: /#provider=ship24&key=apik_...&plan=per-shipment
// The hash never leaves the browser, so the key is not sent to the server or stored in the repo.
export function parseSetupHash(hash) {
  if (typeof hash !== 'string' || !hash) return null;
  const params = new URLSearchParams(hash.replace(/^#\/?/, ''));
  const apiKey = (params.get('key') || '').trim();
  if (!apiKey) return null;
  const provider = params.get('provider') || 'ship24';
  if (!PROVIDERS[provider]) return null;
  const out = { provider, apiKey };
  const plan = params.get('plan');
  if (plan === 'per-shipment' || plan === 'per-call') out.ship24Plan = plan;
  return out;
}

export function tmCode(carrierKey) {
  return (carrierKey && CARRIERS[carrierKey] && CARRIERS[carrierKey].tm) || null;
}

const byNewest = (a, b) => {
  const ta = parseTime(a.time), tb = parseTime(b.time);
  return (tb ? tb.getTime() : 0) - (ta ? ta.getTime() : 0);
};

function base(provider, fields) {
  return {
    provider, status: 'pending', courier: null, origin: null, destination: null, eta: null,
    deliveredAt: null, signedBy: null, events: [], ref: {}, fetchedAt: new Date().toISOString(), ...fields,
  };
}

// --- Ship24 ------------------------------------------------------------------

const S24 = 'https://api.ship24.com/public/v1';

export function normalizeShip24(json) {
  const tr = json && json.data && Array.isArray(json.data.trackings) ? json.data.trackings[0] : null;
  if (!tr) return null;
  const sh = tr.shipment || {};
  const del = sh.delivery || {};
  const raw = Array.isArray(tr.events) ? tr.events : [];
  const events = raw
    .map((e, i) => ({ i, order: e.order || 0, ev: { time: e.occurrenceDatetime || e.datetime || null, text: e.status || '', location: e.location || null, milestone: e.statusMilestone || null } }))
    .sort((a, b) => byNewest(a.ev, b.ev) || (b.order - a.order) || (a.i - b.i))
    .map((x) => x.ev);

  const range = del.courierEstimatedDeliveryDate || {};
  const ai = del.aiPredictiveDeliveryDate || {};
  let eta = null;
  if (del.estimatedDeliveryDate || range.from || range.to) eta = { date: del.estimatedDeliveryDate || null, from: range.from || null, to: range.to || null };
  else if (ai.from || ai.to) eta = { date: null, from: ai.from || null, to: ai.to || null };

  const status = sh.statusMilestone || 'pending';
  const cc = tr.tracker && tr.tracker.courierCode;
  const courier = (Array.isArray(cc) ? cc[0] : cc) || (raw.find((e) => e.courierCode) || {}).courierCode || null;
  const stamps = (tr.statistics && tr.statistics.timestamps) || {};
  const deliveredEvent = events.find((e) => e.milestone === 'delivered');
  return base('ship24', {
    status, courier,
    origin: sh.originCountryCode || null,
    destination: sh.destinationCountryCode || null,
    eta,
    deliveredAt: stamps.deliveredDatetime || (status === 'delivered' && deliveredEvent ? deliveredEvent.time : null),
    signedBy: del.signedBy || null,
    events,
    ref: { trackerId: (tr.tracker && tr.tracker.trackerId) || null },
  });
}

async function s24Call(apiKey, method, path, body, fetchImpl) {
  const res = await fetchImpl(S24 + path, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON body */ }
  if (res.ok) return json || {};
  if (res.status === 401 || res.status === 403) throw new Error('Ship24 rejected the API key. Check it in Settings.');
  if (res.status === 429) throw new Error('Ship24 rate limit hit. Try again in a moment.');
  const msg = (json && Array.isArray(json.errors) && json.errors.map((e) => e.message || e.code).join(' ')) || (json && json.message) || `HTTP ${res.status}`;
  throw new Error(`Ship24: ${msg}`);
}

async function fetchShip24(settings, shipment, fetchImpl) {
  const path = settings.ship24Plan === 'per-call' ? '/tracking/search' : '/trackers/track';
  const json = await s24Call(settings.apiKey, 'POST', path, { trackingNumber: shipment.number }, fetchImpl);
  const t = normalizeShip24(json);
  if (!t) throw new Error('Ship24 has nothing on this number yet. Refresh in a minute.');
  return t;
}

// --- TrackingMore ------------------------------------------------------------

const TM = 'https://api.trackingmore.com/v4';
const TM_STATUS = {
  inforeceived: 'info_received', transit: 'in_transit', pickup: 'out_for_delivery', undelivered: 'failed_attempt',
  delivered: 'delivered', exception: 'exception', expired: 'expired', notfound: 'pending', pending: 'pending',
};

const tmStatus = (status, sub) => (status === 'pickup' && sub === 'pickup002' ? 'available_for_pickup' : TM_STATUS[status] || 'pending');
const isoTime = (s) => (typeof s === 'string' && s.trim() ? s.trim().replace(' ', 'T') : null);

export function normalizeTrackingMore(obj) {
  const seen = new Set();
  const events = [];
  for (const info of [obj.origin_info, obj.destination_info]) {
    for (const c of (info && Array.isArray(info.trackinfo)) ? info.trackinfo : []) {
      const ev = {
        time: isoTime(c.checkpoint_date || c.Date),
        text: c.tracking_detail || c.StatusDescription || '',
        location: c.location || c.Details || null,
        milestone: tmStatus(c.checkpoint_delivery_status || c.checkpoint_status, c.checkpoint_delivery_substatus),
      };
      const key = `${ev.time}|${ev.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(ev);
    }
  }
  events.sort(byNewest);

  const status = tmStatus(obj.delivery_status, obj.substatus);
  const milestones = (obj.origin_info && obj.origin_info.milestone_date) || (obj.destination_info && obj.destination_info.milestone_date) || {};
  const deliveredEvent = events.find((e) => e.milestone === 'delivered');
  return base('trackingmore', {
    status,
    courier: obj.courier_code || (obj.origin_info && obj.origin_info.courier_code) || null,
    origin: obj.origin_country || null,
    destination: obj.destination_country || null,
    eta: obj.scheduled_delivery_date ? { date: isoTime(obj.scheduled_delivery_date), from: null, to: null } : null,
    deliveredAt: isoTime(milestones.delivery_date) || (status === 'delivered' && deliveredEvent ? deliveredEvent.time : null),
    signedBy: obj.signed_by || null,
    events,
    ref: { id: obj.id || null },
  });
}

function tmError(code, message, http) {
  let e;
  if (code === 401 || http === 401) e = new Error('TrackingMore rejected the API key. Check it in Settings.');
  else if (code === 4190) e = new Error('TrackingMore quota is used up for this month. Upgrade the plan or switch provider in Settings.');
  else if (code === 429 || http === 429) e = new Error('TrackingMore rate limit hit. Try again in a moment.');
  else if (code === 4121) e = new Error("TrackingMore can't detect the carrier for this number. Pick one on the card.");
  else e = new Error(`TrackingMore error ${code}: ${message || 'unknown'}`);
  e.code = code;
  return e;
}

async function tmCall(apiKey, method, path, body, fetchImpl) {
  const res = await fetchImpl(TM + path, {
    method,
    headers: { 'Tracking-Api-Key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON body */ }
  if (!json) {
    if (res.ok) return {};
    throw tmError(res.status, null, res.status);
  }
  const code = json.meta && typeof json.meta.code === 'number' ? json.meta.code : res.status;
  if (code >= 200 && code < 300) return json;
  throw tmError(code, json.meta && json.meta.message, res.status);
}

async function fetchTrackingMore(settings, shipment, fetchImpl) {
  const key = settings.apiKey;
  const number = shipment.number;

  const getExisting = async () => {
    const j = await tmCall(key, 'GET', `/trackings/get?tracking_numbers=${encodeURIComponent(number)}`, null, fetchImpl);
    const list = Array.isArray(j.data) ? j.data : (j.data && Array.isArray(j.data.items)) ? j.data.items : j.data ? [j.data] : [];
    return list.find((t) => t && t.tracking_number === number) || list[0] || null;
  };

  if (shipment.ref && shipment.ref.id) {
    const t = await getExisting();
    if (t) return normalizeTrackingMore(t);
  }

  let courier = tmCode(shipment.carrier);
  if (!courier) {
    const d = await tmCall(key, 'POST', '/couriers/detect', { tracking_number: number }, fetchImpl);
    courier = (Array.isArray(d.data) && d.data[0] && d.data[0].courier_code) || null;
    if (!courier) throw new Error("TrackingMore can't detect the carrier for this number. Pick one on the card.");
  }

  try {
    const payload = { tracking_number: number, courier_code: courier };
    if (shipment.item) payload.title = String(shipment.item).slice(0, 200);
    const c = await tmCall(key, 'POST', '/trackings/create', payload, fetchImpl);
    if (c.data && c.data.tracking_number) return normalizeTrackingMore(c.data);
  } catch (e) {
    if (e.code !== 4101) throw e; // 4101 = already registered: fall through to get
  }
  const t = await getExisting();
  if (!t) throw new Error('TrackingMore has no record for this number yet. Refresh in a minute.');
  return normalizeTrackingMore(t);
}

// --- public entry points -----------------------------------------------------

export async function fetchTracking(settings, shipment, fetchImpl = globalThis.fetch) {
  const provider = settings && settings.provider;
  if (!PROVIDERS[provider]) throw new Error('No tracking provider selected. Pick one in Settings.');
  if (!settings.apiKey) throw new Error(`Add your ${PROVIDERS[provider].name} API key in Settings.`);
  return provider === 'ship24' ? fetchShip24(settings, shipment, fetchImpl) : fetchTrackingMore(settings, shipment, fetchImpl);
}

export async function testKey(settings, fetchImpl = globalThis.fetch) {
  const provider = settings && settings.provider;
  if (!PROVIDERS[provider]) return { ok: false, message: 'Pick a provider first.' };
  if (!settings.apiKey) return { ok: false, message: 'Paste a key first.' };
  try {
    if (provider === 'ship24') await s24Call(settings.apiKey, 'GET', '/couriers', null, fetchImpl);
    else await tmCall(settings.apiKey, 'GET', '/couriers/all', null, fetchImpl);
    return { ok: true, message: 'Key works' };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}
