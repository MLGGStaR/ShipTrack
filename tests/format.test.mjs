import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTime, statusLabel, arrivalCopy, statusTone, relativeTime, eventTime, milestoneStep } from '../format.js';

const now = new Date('2026-09-08T12:00:00'); // a Tuesday, local time

// --- parseTime ---------------------------------------------------------------

test('parseTime accepts TrackingMore space-separated times as local time', () => {
  assert.equal(parseTime('2024-05-01 10:00').getTime(), new Date('2024-05-01T10:00:00').getTime());
  assert.equal(parseTime('2024-05-01 10:00:30').getTime(), new Date('2024-05-01T10:00:30').getTime());
});

test('parseTime treats a bare date as local midnight, not UTC', () => {
  assert.equal(parseTime('2021-03-04').getTime(), new Date('2021-03-04T00:00:00').getTime());
});

test('parseTime keeps explicit offsets and rejects junk', () => {
  assert.equal(parseTime('2021-03-04T17:12:57Z').getTime(), Date.parse('2021-03-04T17:12:57Z'));
  assert.equal(parseTime('2021-03-04T17:12:57+04:00').getTime(), Date.parse('2021-03-04T17:12:57+04:00'));
  assert.equal(parseTime(null), null);
  assert.equal(parseTime(''), null);
  assert.equal(parseTime('garbage'), null);
});

// --- statusLabel -------------------------------------------------------------

test('statusLabel gives plain words', () => {
  assert.equal(statusLabel('out_for_delivery'), 'Out for delivery');
  assert.equal(statusLabel('available_for_pickup'), 'Ready for pickup');
  assert.equal(statusLabel('info_received'), 'Info received');
  assert.equal(statusLabel('failed_attempt'), 'Failed attempt');
  assert.equal(statusLabel('delivered'), 'Delivered');
  assert.equal(statusLabel('pending'), 'Pending');
  assert.equal(statusLabel('whatever'), 'Unknown');
});

// --- arrivalCopy: the headline and detail line that lead every card ----------

const ev = (text, location) => ({ time: '2026-09-08T09:00:00', text, location, milestone: null });

test('arrival: delivered shows when, and who signed', () => {
  assert.deepEqual(arrivalCopy({ status: 'delivered', deliveredAt: '2026-09-04T17:12:57' }, now), { headline: 'Delivered', detail: 'Fri 4 Sep, 17:12' });
  assert.deepEqual(arrivalCopy({ status: 'delivered', deliveredAt: '2026-09-04T17:12:57', signedBy: 'John' }, now), { headline: 'Delivered', detail: 'Fri 4 Sep, 17:12 · signed by John' });
  assert.deepEqual(arrivalCopy({ status: 'delivered', deliveredAt: null, events: [] }, now), { headline: 'Delivered', detail: '' });
});

test('arrival: out for delivery is arriving today, with the carrier time when known', () => {
  assert.deepEqual(arrivalCopy({ status: 'out_for_delivery', eta: { date: '2026-09-08T18:00:00' } }, now), { headline: 'Arriving today', detail: 'by 18:00' });
  assert.deepEqual(arrivalCopy({ status: 'out_for_delivery', eta: null }, now), { headline: 'Arriving today', detail: 'Out for delivery' });
});

test('arrival: pickup, failed attempt, exception, expired and pending read plainly', () => {
  assert.deepEqual(arrivalCopy({ status: 'available_for_pickup', events: [ev('Ready for collection', 'Dubai, AE')] }, now), { headline: 'Ready for pickup', detail: 'Dubai, AE' });
  assert.deepEqual(arrivalCopy({ status: 'available_for_pickup', events: [] }, now), { headline: 'Ready for pickup', detail: 'Collect it from the carrier' });
  assert.deepEqual(arrivalCopy({ status: 'failed_attempt', events: [ev('Customer not available', 'Abu Dhabi')] }, now), { headline: 'Delivery attempt failed', detail: 'Customer not available' });
  assert.deepEqual(arrivalCopy({ status: 'failed_attempt', events: [] }, now), { headline: 'Delivery attempt failed', detail: 'The carrier will try again' });
  assert.deepEqual(arrivalCopy({ status: 'exception', events: [ev('Held at customs', null)] }, now), { headline: 'Needs attention', detail: 'Held at customs' });
  assert.deepEqual(arrivalCopy({ status: 'expired', events: [] }, now), { headline: 'No updates in 30 days', detail: 'Check with the carrier' });
  assert.deepEqual(arrivalCopy({ status: 'pending', events: [] }, now), { headline: 'Waiting for first scan', detail: 'Usually updates within a day' });
});

test('arrival: in transit with an estimate says when', () => {
  assert.deepEqual(arrivalCopy({ status: 'in_transit', eta: { date: '2026-09-08T18:00:00' } }, now), { headline: 'Arriving today', detail: 'by 18:00' });
  assert.deepEqual(arrivalCopy({ status: 'in_transit', eta: { date: '2026-09-09' } }, now), { headline: 'Arriving tomorrow', detail: 'In transit' });
  assert.deepEqual(arrivalCopy({ status: 'in_transit', eta: { date: '2026-09-12' } }, now), { headline: 'Arriving Sat 12 Sep', detail: 'In transit' });
  assert.deepEqual(arrivalCopy({ status: 'info_received', eta: { date: '2026-09-12' } }, now), { headline: 'Arriving Sat 12 Sep', detail: 'Label created' });
  assert.deepEqual(arrivalCopy({ status: 'in_transit', eta: { date: null, from: '2026-09-12', to: '2026-09-14' } }, now), { headline: 'Arriving 12–14 Sep', detail: 'In transit' });
});

test('arrival: a missed estimate is overdue, and no estimate says so', () => {
  assert.deepEqual(arrivalCopy({ status: 'in_transit', eta: { date: '2026-09-05' } }, now), { headline: 'Overdue', detail: 'Was due Sat 5 Sep' });
  assert.deepEqual(arrivalCopy({ status: 'in_transit', eta: null }, now), { headline: 'In transit', detail: 'No estimate yet' });
  assert.deepEqual(arrivalCopy({ status: 'info_received', eta: null }, now), { headline: 'Label created', detail: 'Not scanned yet' });
  assert.deepEqual(arrivalCopy(null, now), { headline: 'Not tracked yet', detail: '' });
});

// --- statusTone: which of the status colors a card wears ---------------------

test('statusTone gives every state its own color family', () => {
  assert.equal(statusTone({ status: 'delivered' }, now), 'done');
  assert.equal(statusTone({ status: 'out_for_delivery' }, now), 'live');
  assert.equal(statusTone({ status: 'in_transit', eta: { date: '2026-09-08T18:00:00' } }, now), 'live');
  assert.equal(statusTone({ status: 'in_transit', eta: { date: '2026-09-09' } }, now), 'live');
  assert.equal(statusTone({ status: 'info_received', eta: { date: '2026-09-09' } }, now), 'live');
  assert.equal(statusTone({ status: 'available_for_pickup' }, now), 'pickup');
  assert.equal(statusTone({ status: 'in_transit', eta: { date: '2026-09-12' } }, now), 'transit');
  assert.equal(statusTone({ status: 'in_transit', eta: null }, now), 'transit');
  assert.equal(statusTone({ status: 'info_received', eta: null }, now), 'label');
  assert.equal(statusTone({ status: 'pending' }, now), 'pending');
  assert.equal(statusTone({ status: 'in_transit', eta: { date: '2026-09-05' } }, now), 'warn');
  assert.equal(statusTone({ status: 'failed_attempt' }, now), 'warn');
  assert.equal(statusTone({ status: 'exception' }, now), 'bad');
  assert.equal(statusTone({ status: 'expired' }, now), 'idle');
  assert.equal(statusTone(null, now), 'idle');
});

// --- relativeTime ------------------------------------------------------------

test('relativeTime reads naturally', () => {
  assert.equal(relativeTime('2026-09-08T11:59:30', now), 'just now');
  assert.equal(relativeTime('2026-09-08T11:45:00', now), '15 min ago');
  assert.equal(relativeTime('2026-09-08T09:00:00', now), '3 h ago');
  assert.equal(relativeTime('2026-09-07T12:00:00', now), 'yesterday');
  assert.equal(relativeTime('2026-09-04T12:00:00', now), '4 days ago');
  assert.equal(relativeTime('2026-08-01T12:00:00', now), '1 Aug');
  assert.equal(relativeTime('2025-08-01T12:00:00', now), '1 Aug 2025');
  assert.equal(relativeTime(null, now), '');
});

// --- eventTime ---------------------------------------------------------------

test('eventTime shows day, month and 24h time, with the year only when it differs', () => {
  assert.equal(eventTime('2026-09-04T17:12:57', now), '4 Sep, 17:12');
  assert.equal(eventTime('2021-03-04T07:05:00', now), '4 Mar 2021, 07:05');
  assert.equal(eventTime('2026-09-04', now), '4 Sep');
  assert.equal(eventTime(null, now), '');
});

// --- milestoneStep -----------------------------------------------------------

test('milestoneStep places each status on the 4-step strip', () => {
  assert.deepEqual(milestoneStep('pending'), { step: -1, stalled: false });
  assert.deepEqual(milestoneStep('info_received'), { step: 0, stalled: false });
  assert.deepEqual(milestoneStep('in_transit'), { step: 1, stalled: false });
  assert.deepEqual(milestoneStep('out_for_delivery'), { step: 2, stalled: false });
  assert.deepEqual(milestoneStep('available_for_pickup'), { step: 2, stalled: false });
  assert.deepEqual(milestoneStep('failed_attempt'), { step: 2, stalled: true });
  assert.deepEqual(milestoneStep('delivered'), { step: 3, stalled: false });
  assert.deepEqual(milestoneStep('exception'), { step: 1, stalled: true });
  assert.deepEqual(milestoneStep('expired'), { step: 1, stalled: true });
});
