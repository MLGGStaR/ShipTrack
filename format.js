// format.js — pure display helpers (dates, labels, arrival copy). No DOM.

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
const hasClock = (iso) => typeof iso === 'string' && /T\d{2}:\d{2}/.test(iso.replace(' ', 'T'));
export const dayName = (d) => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
const dayMonth = (d, now) => `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ''}`;

// "Fri 4 Sep, 17:12" for a full timestamp, "Fri 4 Sep" for a bare date.
function whenText(iso, now) {
  const d = parseTime(iso);
  if (!d) return '';
  const year = d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : '';
  const clock = hasClock(iso) && !(d.getHours() === 0 && d.getMinutes() === 0 && !/T00:00/.test(iso)) ? `, ${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
  return `${dayName(d)}${year}${clock}`;
}

// Reads a carrier estimate into one of: today (with a clock when given), tomorrow, a day, a range, or overdue.
function arrivalWhen(eta, now) {
  if (!eta) return null;
  const date = parseTime(eta.date);
  const from = parseTime(eta.from);
  const to = parseTime(eta.to);
  let single = date || null;
  let singleIso = eta.date;
  if (!single && from && to && dayKey(from) === dayKey(to)) { single = from; singleIso = eta.from; }
  if (!single && from && !to) { single = from; singleIso = eta.from; }
  if (!single && !from && to) { single = to; singleIso = eta.to; }

  const nk = dayKey(now);
  if (single) {
    const dk = dayKey(single);
    const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
    if (dk < nk) return { kind: 'overdue', due: dayName(single) };
    const clock = hasClock(singleIso) && !(single.getHours() === 0 && single.getMinutes() === 0) ? `${pad(single.getHours())}:${pad(single.getMinutes())}` : null;
    if (dk === nk) return { kind: 'today', clock };
    if (dk === dayKey(tomorrow)) return { kind: 'tomorrow', clock };
    return { kind: 'day', text: dayName(single), clock };
  }
  if (from && to) {
    if (dayKey(to) < nk) return { kind: 'overdue', due: dayName(to) };
    const sameMonth = from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear();
    const text = sameMonth ? `${from.getDate()}–${to.getDate()} ${MONTHS[to.getMonth()]}` : `${from.getDate()} ${MONTHS[from.getMonth()]}–${to.getDate()} ${MONTHS[to.getMonth()]}`;
    return { kind: 'range', text };
  }
  return null;
}

// The headline and detail line that lead every card: the answer to "when?".
export function arrivalCopy(track, now = new Date()) {
  if (!track) return { headline: 'Not tracked yet', detail: '' };
  const ev = (track.events || [])[0];
  const when = arrivalWhen(track.eta, now);
  switch (track.status) {
    case 'delivered': {
      const deliveredEvent = (track.events || []).find((e) => e.milestone === 'delivered');
      const iso = track.deliveredAt || (deliveredEvent ? deliveredEvent.time : null);
      const text = whenText(iso, now);
      return { headline: 'Delivered', detail: text ? `${text}${track.signedBy ? ` · signed by ${track.signedBy}` : ''}` : '' };
    }
    case 'out_for_delivery':
      return { headline: 'Arriving today', detail: when && when.kind === 'today' && when.clock ? `by ${when.clock}` : 'Out for delivery' };
    case 'available_for_pickup':
      return { headline: 'Ready for pickup', detail: (ev && ev.location) || 'Collect it from the carrier' };
    case 'failed_attempt':
      return { headline: 'Delivery attempt failed', detail: (ev && ev.text) || 'The carrier will try again' };
    case 'exception':
      return { headline: 'Needs attention', detail: (ev && ev.text) || 'Check with the carrier' };
    case 'expired':
      return { headline: 'No updates in 30 days', detail: 'Check with the carrier' };
    case 'pending':
      return { headline: 'Waiting for first scan', detail: 'Usually updates within a day' };
    case 'in_transit':
    case 'info_received': {
      const base = track.status === 'in_transit' ? 'In transit' : 'Label created';
      if (!when) return { headline: base, detail: track.status === 'in_transit' ? 'No estimate yet' : 'Not scanned yet' };
      if (when.kind === 'overdue') return { headline: 'Overdue', detail: `Was due ${when.due}` };
      if (when.kind === 'today') return { headline: 'Arriving today', detail: when.clock ? `by ${when.clock}` : base };
      if (when.kind === 'tomorrow') return { headline: 'Arriving tomorrow', detail: base };
      return { headline: `Arriving ${when.text}`, detail: base };
    }
    default:
      return { headline: statusLabel(track.status), detail: '' };
  }
}

// Which color family a card wears. Each state has its own:
// live (arriving today/tomorrow, out for delivery), pickup, transit, label (created, not scanned),
// pending (waiting for the first scan), done, warn (failed attempt, overdue), bad (exception), idle.
export function statusTone(track, now = new Date()) {
  if (!track) return 'idle';
  switch (track.status) {
    case 'delivered': return 'done';
    case 'out_for_delivery': return 'live';
    case 'available_for_pickup': return 'pickup';
    case 'failed_attempt': return 'warn';
    case 'exception': return 'bad';
    case 'pending': return 'pending';
    case 'expired': return 'idle';
    case 'in_transit':
    case 'info_received': {
      const when = arrivalWhen(track.eta, now);
      if (when && when.kind === 'overdue') return 'warn';
      if (when && (when.kind === 'today' || when.kind === 'tomorrow')) return 'live';
      return track.status === 'in_transit' ? 'transit' : 'label';
    }
    default: return 'idle';
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

// Position on the 4-step rail: label created → in transit → out for delivery → delivered.
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
