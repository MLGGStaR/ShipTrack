// carriers.js — carrier detection, deep links and tracking-number extraction.
// Pure functions, no DOM: used by the page and by the Node tests.

const T17 = (n) => `https://t.17track.net/en#nums=${n}`;

// key -> { name, url(number), tm: TrackingMore courier_code (only when certain) }
export const CARRIERS = {
  usps: { name: 'USPS', url: (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`, tm: 'usps' },
  ups: { name: 'UPS', url: (n) => `https://www.ups.com/track?tracknum=${n}`, tm: 'ups' },
  fedex: { name: 'FedEx', url: (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}`, tm: 'fedex' },
  dhl: { name: 'DHL', url: (n) => `https://www.dhl.com/global-en/home/tracking.html?tracking-id=${n}`, tm: 'dhl' },
  aramex: { name: 'Aramex', url: (n) => `https://www.aramex.com/track/results?ShipmentNumber=${n}`, tm: 'aramex' },
  'shop-and-ship': { name: 'Shop & Ship', url: (n) => `https://www.aramex.com/track/results?ShipmentNumber=${n}`, tm: 'aramex' },
  'emirates-post': { name: 'Emirates Post', url: (n) => `https://emiratespost.ae/Portal/Track?TrackingNumber=${n}&locale=en-us`, tm: 'emirates-post' },
  amazon: { name: 'Amazon', url: (n) => `https://track.amazon.com/tracking/${n}` },
  cainiao: { name: 'Cainiao', url: (n) => `https://global.cainiao.com/newDetail.htm?mailNoList=${n}`, tm: 'cainiao' },
  yunexpress: { name: 'Yun Express', url: (n) => `https://www.yuntrack.com/parcelTracking?id=${n}`, tm: 'yunexpress' },
  'china-post': { name: 'China Post', url: T17, tm: 'china-post' },
  'royal-mail': { name: 'Royal Mail', url: (n) => `https://www.royalmail.com/track-your-item#/tracking-results/${n}`, tm: 'royal-mail' },
  'deutsche-post': { name: 'Deutsche Post', url: (n) => `https://www.deutschepost.de/de/s/sendungsverfolgung.html?piececode=${n}` },
  'japan-post': { name: 'Japan Post', url: (n) => `https://trackings.post.japanpost.jp/services/srv/search/direct?reqCodeNo1=${n}&searchKind=S002&locale=en` },
  'canada-post': { name: 'Canada Post', url: (n) => `https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor=${n}` },
  'australia-post': { name: 'Australia Post', url: (n) => `https://auspost.com.au/mypost/track/#/details/${n}` },
  'la-poste': { name: 'La Poste', url: (n) => `https://www.laposte.fr/outils/suivre-vos-envois?code=${n}` },
  correos: { name: 'Correos', url: (n) => `https://www.correos.es/es/es/herramientas/localizador/envios/detalle?tracking-number=${n}` },
  'singapore-post': { name: 'Singapore Post', url: T17 },
  'hongkong-post': { name: 'Hongkong Post', url: T17 },
  postnl: { name: 'PostNL', url: T17 },
  'saudi-post': { name: 'Saudi Post (SPL)', url: T17 },
  'india-post': { name: 'India Post', url: T17 },
  'korea-post': { name: 'Korea Post', url: T17 },
  'poste-italiane': { name: 'Poste Italiane', url: T17 },
  'swiss-post': { name: 'Swiss Post', url: T17 },
  'turkish-post': { name: 'PTT (Turkey)', url: T17 },
  'pos-malaysia': { name: 'Pos Malaysia', url: T17 },
  'thailand-post': { name: 'Thailand Post', url: T17 },
  'intl-post': { name: 'International post', url: T17 },
};

// UPU S10 suffix (country of origin) -> carrier key
const S10 = {
  AE: 'emirates-post', US: 'usps', CN: 'china-post', GB: 'royal-mail', DE: 'deutsche-post',
  JP: 'japan-post', CA: 'canada-post', AU: 'australia-post', FR: 'la-poste', ES: 'correos',
  SG: 'singapore-post', HK: 'hongkong-post', NL: 'postnl', SA: 'saudi-post', IN: 'india-post',
  KR: 'korea-post', IT: 'poste-italiane', CH: 'swiss-post', TR: 'turkish-post', MY: 'pos-malaysia',
  TH: 'thailand-post',
};

export function normalizeNumber(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const hit = (key, confidence = 'high', alternatives = []) => ({ key, name: CARRIERS[key].name, confidence, alternatives });

// Returns { key, name, confidence, alternatives } or null.
export function detectCarrier(raw) {
  const n = normalizeNumber(raw);
  if (!n) return null;

  if (/^1Z[A-Z0-9]{16}$/.test(n)) return hit('ups');
  if (/^TB[ACM]\d{12,}$/.test(n)) return hit('amazon');
  if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(n)) {
    const key = S10[n.slice(-2)];
    return key ? hit(key) : hit('intl-post', 'medium');
  }
  if (/^JJ?D\d{18,}$/.test(n)) return hit('dhl');
  if (/^LP\d{14,16}$/.test(n)) return hit('cainiao');
  if (/^YT\d{16}$/.test(n)) return hit('yunexpress');

  if (/^\d+$/.test(n)) {
    const len = n.length;
    if (len === 22 || len === 20) return n.startsWith('96') ? hit('fedex') : n.startsWith('9') ? hit('usps') : hit('fedex', 'medium');
    if (len === 26 || len === 30) return hit('usps');
    if (len === 15 || len === 12) return hit('fedex', 'medium');
    if (len === 11) return hit('aramex', 'medium', ['shop-and-ship']);
    if (len === 10) return hit('dhl', 'low', ['aramex']);
  }
  return null;
}

// Query/hash parameter names carriers and trackers use for the number.
const URL_KEYS = new Set([
  'tlabels', 'tracknum', 'tracknumbers', 'trknbr', 'shipmentnumber', 'trackingnumber', 'trackingnumbers',
  'tracking_number', 'tracking-id', 'trackingid', 'nums', 'number', 'numbers', 'mailnolist', 'piececode',
  'reqcodeno1', 'searchfor', 'code', 'awb', 'waybill', 'tn', 'id', 'q',
]);

const plausible = (s) => /^[A-Z0-9]{8,40}$/.test(s) && /\d/.test(s);

function fromUrl(u) {
  let url;
  try { url = new URL(u); } catch { return []; }
  const params = new URLSearchParams(url.search);
  const hash = url.hash.replace(/^#\/?/, '');
  if (hash.includes('=')) new URLSearchParams(hash.replace(/^[^?]*\?/, '')).forEach((v, k) => params.append(k, v));
  const out = [];
  for (const [k, v] of params) {
    if (URL_KEYS.has(k.toLowerCase())) for (const part of v.split(/[,;\s]+/)) { const p = normalizeNumber(part); if (plausible(p)) out.push(p); }
  }
  if (!out.length) {
    const segs = (url.pathname + '/' + hash.replace(/\?.*$/, '')).split('/').filter(Boolean).reverse();
    for (const s of segs) { const p = normalizeNumber(s); if (plausible(p) && detectCarrier(p)) { out.push(p); break; } }
  }
  return out;
}

// Pull tracking numbers out of anything pasted: URLs, comma/newline lists, or free text.
export function extractNumbers(text) {
  const found = [];
  let rest = String(text || '');
  for (const u of rest.match(/https?:\/\/\S+/gi) || []) found.push(...fromUrl(u));
  rest = rest.replace(/https?:\/\/\S+/gi, ' ');

  for (const chunk of rest.split(/[,;\n\r]+/)) {
    const collapsed = normalizeNumber(chunk);
    if (!collapsed) continue;
    if (detectCarrier(collapsed)) { found.push(collapsed); continue; }
    const tokens = chunk.split(/\s+/).map((t) => normalizeNumber(t)).filter(plausible);
    const hits = tokens.filter((t) => detectCarrier(t));
    found.push(...(hits.length ? hits : tokens));
  }
  return [...new Set(found)];
}

// A short bare number ("14431", "Order #1004") is a store's order number, which no carrier can track.
export function orderRefFrom(text) {
  const m = String(text || '').trim().match(/^(?:order\s*)?#?(\d{3,7})$/i);
  return m ? m[1] : null;
}

export function looksLikeOrderNumber(text) {
  return orderRefFrom(text) !== null;
}

export function trackingUrl(key, number) {
  const n = normalizeNumber(number);
  return (CARRIERS[key] || CARRIERS['intl-post']).url(n);
}

export function universalLinks(number) {
  const n = normalizeNumber(number);
  return [
    { name: '17TRACK', url: T17(n) },
    { name: 'Parcels', url: `https://parcelsapp.com/en/tracking/${n}` },
  ];
}
