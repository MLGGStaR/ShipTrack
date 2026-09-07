import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTime, statusLabel, stampText, relativeTime, eventTime, milestoneStep } from '../format.js';

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

// --- stampText ---------------------------------------------------------------

test('stamp: delivered shows the delivery day', () => {
  assert.deepEqual(stampText({ status: 'delivered', deliveredAt: '2026-09-04T17:12:57' }, now), { line1: 'Delivered', line2: 'Fri 4 Sep' });
});

test('stamp: delivered without a date still reads delivered', () => {
  assert.deepEqual(stampText({ status: 'delivered', deliveredAt: null, events: [] }, now), { line1: 'Delivered', line2: '' });
});

test('stamp: in transit with an ETA says when', () => {
  assert.deepEqual(stampText({ status: 'in_transit', eta: { date: '2026-09-08T18:00:00' } }, now), { line1: 'Arriving', line2: 'Today' });
  assert.deepEqual(stampText({ status: 'in_transit', eta: { date: '2026-09-09' } }, now), { line1: 'Arriving', line2: 'Tomorrow' });
  assert.deepEqual(stampText({ status: 'in_transit', eta: { date: '2026-09-12' } }, now), { line1: 'Arriving', line2: 'Sat 12 Sep' });
  assert.deepEqual(stampText({ status: 'info_received', eta: { date: '2026-09-12' } }, now), { line1: 'Arriving', line2: 'Sat 12 Sep' });
});

test('stamp: an ETA range shows both days', () => {
  assert.deepEqual(stampText({ status: 'in_transit', eta: { date: null, from: '2026-09-12', to: '2026-09-14' } }, now), { line1: 'Arriving', line2: '12–14 Sep' });
});

test('stamp: a missed ETA is overdue', () => {
  assert.deepEqual(stampText({ status: 'in_transit', eta: { date: '2026-09-05' } }, now), { line1: 'Overdue', line2: 'Due Sat 5 Sep' });
});

test('stamp: statuses without an ETA', () => {
  assert.deepEqual(stampText({ status: 'in_transit', eta: null }, now), { line1: 'In', line2: 'transit' });
  assert.deepEqual(stampText({ status: 'info_received', eta: null }, now), { line1: 'Label', line2: 'created' });
  assert.deepEqual(stampText({ status: 'out_for_delivery', eta: null }, now), { line1: 'Arriving', line2: 'Today' });
  assert.deepEqual(stampText({ status: 'available_for_pickup' }, now), { line1: 'Ready for', line2: 'pickup' });
  assert.deepEqual(stampText({ status: 'failed_attempt' }, now), { line1: 'Delivery', line2: 'failed' });
  assert.deepEqual(stampText({ status: 'exception' }, now), { line1: 'Exception', line2: 'check carrier' });
  assert.deepEqual(stampText({ status: 'expired' }, now), { line1: 'No updates', line2: '30+ days' });
  assert.deepEqual(stampText({ status: 'pending' }, now), { line1: 'Waiting', line2: 'for scan' });
  assert.deepEqual(stampText(null, now), { line1: 'Not', line2: 'tracked' });
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
