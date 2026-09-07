// format.js — pure display helpers (dates, labels, stamp copy). No DOM.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Carrier times come in three flavours: "YYYY-MM-DD", "YYYY-MM-DD HH:MM[:SS]" and ISO with/without offset.
// Anything without an offset is the carrier's local time, so it is parsed as local and shown as-is.
export function parseTime(s) {
  if (typeof s !== 'string') return null;
  let v = s.trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) v += 'T00:00:00';
  else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(v)) v = v.replace(' ', 'T');
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const LABELS = {
  pending: 'Pending', info_received: 'Info received', in_transit: 'In transit', out_for_delivery: 'Out for delivery',
  failed_attempt: 'Failed attempt', available_for_pickup: 'Ready for pickup', delivered: 'Delivered',
  exception: 'Exception', expired: 'Expired',
};

export function statusLabel(status) {
  return LABELS[status] || 'Unknown';
}

const dayKey = (d) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
const pad = (n) => String(n).padStart(2, '0');
export const dayName = (d) => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
const dayMonth = (d, now) => `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ''}`;

function arrivalLine(eta, now) {
  if (!eta) return null;
  const date = parseTime(eta.date);
  const from = parseTime(eta.from);
  const to = parseTime(eta.to);
  let single = date || null;
  if (!single && from && to && dayKey(from) === dayKey(to)) single = from;
  if (!single && from && !to) single = from;
  if (!single && !from && to) single = to;

  if (single) {
    const dk = dayKey(single), nk = dayKey(now);
    const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
    if (dk < nk) return { line1: 'Overdue', line2: `Due ${dayName(single)}` };
    if (dk === nk) return { line1: 'Arriving', line2: 'Today' };
    if (dk === dayKey(tomorrow)) return { line1: 'Arriving', line2: 'Tomorrow' };
    return { line1: 'Arriving', line2: dayName(single) };
  }
  if (from && to) {
    if (dayKey(to) < dayKey(now)) return { line1: 'Overdue', line2: `Due ${dayName(to)}` };
    const sameMonth = from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear();
    const span = sameMonth ? `${from.getDate()}–${to.getDate()} ${MONTHS[to.getMonth()]}` : `${from.getDate()} ${MONTHS[from.getMonth()]}–${to.getDate()} ${MONTHS[to.getMonth()]}`;
    return { line1: 'Arriving', line2: span };
  }
  return null;
}

// The two lines printed on a card's status stamp.
export function stampText(track, now = new Date()) {
  if (!track) return { line1: 'Not', line2: 'tracked' };
  switch (track.status) {
    case 'delivered': {
      const ev = (track.events || []).find((e) => e.milestone === 'delivered');
      const d = parseTime(track.deliveredAt) || (ev ? parseTime(ev.time) : null);
      return { line1: 'Delivered', line2: d ? dayName(d) : '' };
    }
    case 'out_for_delivery': return { line1: 'Arriving', line2: 'Today' };
    case 'available_for_pickup': return { line1: 'Ready for', line2: 'pickup' };
    case 'failed_attempt': return { line1: 'Delivery', line2: 'failed' };
    case 'exception': return { line1: 'Exception', line2: 'check carrier' };
    case 'expired': return { line1: 'No updates', line2: '30+ days' };
    case 'pending': return { line1: 'Waiting', line2: 'for scan' };
    case 'in_transit': return arrivalLine(track.eta, now) || { line1: 'In', line2: 'transit' };
    case 'info_received': return arrivalLine(track.eta, now) || { line1: 'Label', line2: 'created' };
    default: return { line1: statusLabel(track.status), line2: '' };
  }
}

export function relativeTime(iso, now = new Date()) {
  const d = parseTime(iso);
  if (!d) return '';
  const s = (now.getTime() - d.getTime()) / 1000;
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.floor(h / 24);
  if (days < 2) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return dayMonth(d, now);
}

export function eventTime(iso, now = new Date()) {
  const d = parseTime(iso);
  if (!d) return '';
  const dateOnly = /^\s*\d{4}-\d{2}-\d{2}\s*$/.test(iso);
  return dateOnly ? dayMonth(d, now) : `${dayMonth(d, now)}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Position on the 4-step strip: info received → in transit → out for delivery → delivered.
export function milestoneStep(status) {
  switch (status) {
    case 'info_received': return { step: 0, stalled: false };
    case 'in_transit': return { step: 1, stalled: false };
    case 'out_for_delivery':
    case 'available_for_pickup': return { step: 2, stalled: false };
    case 'failed_attempt': return { step: 2, stalled: true };
    case 'delivered': return { step: 3, stalled: false };
    case 'exception':
    case 'expired': return { step: 1, stalled: true };
    default: return { step: -1, stalled: false };
  }
}
