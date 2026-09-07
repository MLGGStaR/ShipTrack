import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, normalizeShip24, normalizeTrackingMore, fetchTracking, testKey } from '../providers.js';

// --- fixtures ----------------------------------------------------------------

const ship24Example = {
  data: {
    trackings: [{
      tracker: { trackerId: '26148317-7502-d3ac-44a9-546d240ac0dd', trackingNumber: '9400115901047177598206', courierCode: ['us-post'] },
      shipment: {
        shipmentId: 'f4f888d7', statusCode: 'delivery_delivered', statusCategory: 'delivery', statusMilestone: 'delivered',
        originCountryCode: 'CN', destinationCountryCode: 'US',
        trackingNumbers: [{ tn: '9400111202544843610364' }, { tn: '9400115901047177598206' }],
        delivery: {
          estimatedDeliveryDate: '2021-03-04T18:00:00',
          courierEstimatedDeliveryDate: { from: '2021-03-04T17:00:00', to: '2021-03-04T18:00:00' },
          service: 'Parcel Post', signedBy: 'John Doe',
        },
      },
      // deliberately out of order: the adapter must sort newest first
      events: [
        { status: 'Out for Delivery', occurrenceDatetime: '2021-03-04T10:12:57', order: 8, location: 'SAN RAFAEL, CA 94901', courierCode: 'us-post', statusMilestone: 'out_for_delivery' },
        { status: 'Delivered to the addressee', occurrenceDatetime: '2021-03-04T17:12:57', order: 9, location: 'SAN RAFAEL, CA 94901', courierCode: 'us-post', statusMilestone: 'delivered' },
        { status: 'Package Received', occurrenceDatetime: '2021-03-02T09:00:00', order: 1, location: 'Beijing', courierCode: 'us-post', statusMilestone: 'info_received' },
      ],
      statistics: { timestamps: { infoReceivedDatetime: '2021-03-02T09:00:00', inTransitDatetime: '2021-03-02T19:24:57', outForDeliveryDatetime: '2021-03-04T10:12:57', failedAttemptDatetime: null, availableForPickupDatetime: null, exceptionDatetime: null, deliveredDatetime: '2021-03-04T17:12:57' } },
    }],
  },
};

const ship24Pending = {
  data: { trackings: [{ tracker: { trackerId: 'pend-1', trackingNumber: 'EE013142149AE' }, shipment: { statusMilestone: 'pending', delivery: { estimatedDeliveryDate: null } }, events: [], statistics: { timestamps: {} } }] },
};

const tmTracking = {
  id: 'abc123', tracking_number: '47473387872', courier_code: 'aramex', delivery_status: 'pickup', substatus: 'pickup002',
  latest_event: 'Ready for collection at Aramex Dubai', latest_checkpoint_time: '2024-05-03 09:15', scheduled_delivery_date: '2024-05-03',
  origin_country: 'US', destination_country: 'AE', signed_by: null,
  origin_info: {
    courier_code: 'aramex',
    milestone_date: { inforeceived_date: '2024-04-28 12:00', pickup_date: '2024-04-29 08:00', outfordelivery_date: null, delivery_date: null },
    trackinfo: [
      { checkpoint_date: '2024-05-03 09:15', checkpoint_delivery_status: 'pickup', checkpoint_delivery_substatus: 'pickup002', tracking_detail: 'Ready for collection at Aramex Dubai', location: 'Dubai, AE' },
      { checkpoint_date: '2024-04-29 08:00', checkpoint_delivery_status: 'transit', checkpoint_delivery_substatus: 'transit006', tracking_detail: 'Shipment picked up', location: 'New York, US' },
    ],
  },
  destination_info: {
    courier_code: 'aramex',
    trackinfo: [
      { checkpoint_date: '2024-05-02 20:00', checkpoint_delivery_status: 'transit', checkpoint_delivery_substatus: 'transit004', tracking_detail: 'Arrived in destination country', location: 'Dubai, AE' },
      { checkpoint_date: '2024-04-29 08:00', checkpoint_delivery_status: 'transit', checkpoint_delivery_substatus: 'transit006', tracking_detail: 'Shipment picked up', location: 'New York, US' },
    ],
  },
};

function fakeFetch(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, init });
    const r = routes.find((x) => url.includes(x.match) && (!x.method || x.method === (init.method || 'GET')));
    if (!r) throw new Error('unexpected request ' + url);
    const body = typeof r.body === 'function' ? r.body(init) : r.body;
    const status = r.status || 200;
    return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) };
  };
  f.calls = calls;
  return f;
}

const tmSettings = { provider: 'trackingmore', apiKey: 'TMKEY' };
const s24Settings = { provider: 'ship24', apiKey: 'S24KEY' };

// --- provider metadata -------------------------------------------------------

test('both providers expose a name and a place to get a key', () => {
  for (const key of ['trackingmore', 'ship24']) {
    assert.ok(PROVIDERS[key].name);
    assert.match(PROVIDERS[key].keyUrl, /^https:\/\//);
  }
});

// --- normalizeShip24 ---------------------------------------------------------

test('normalizeShip24 maps the documented example', () => {
  const t = normalizeShip24(ship24Example);
  assert.equal(t.provider, 'ship24');
  assert.equal(t.status, 'delivered');
  assert.equal(t.courier, 'us-post');
  assert.equal(t.origin, 'CN');
  assert.equal(t.destination, 'US');
  assert.deepEqual(t.eta, { date: '2021-03-04T18:00:00', from: '2021-03-04T17:00:00', to: '2021-03-04T18:00:00' });
  assert.equal(t.deliveredAt, '2021-03-04T17:12:57');
  assert.equal(t.signedBy, 'John Doe');
  assert.equal(t.ref.trackerId, '26148317-7502-d3ac-44a9-546d240ac0dd');
});

test('normalizeShip24 sorts events newest first and keeps text, time, location, milestone', () => {
  const t = normalizeShip24(ship24Example);
  assert.equal(t.events.length, 3);
  assert.deepEqual(t.events[0], { time: '2021-03-04T17:12:57', text: 'Delivered to the addressee', location: 'SAN RAFAEL, CA 94901', milestone: 'delivered' });
  assert.equal(t.events[1].text, 'Out for Delivery');
  assert.equal(t.events[2].text, 'Package Received');
});

test('normalizeShip24 handles a pending tracker with no events', () => {
  const t = normalizeShip24(ship24Pending);
  assert.equal(t.status, 'pending');
  assert.equal(t.eta, null);
  assert.equal(t.deliveredAt, null);
  assert.deepEqual(t.events, []);
});

test('normalizeShip24 returns null when there are no trackings', () => {
  assert.equal(normalizeShip24({ data: { trackings: [] } }), null);
  assert.equal(normalizeShip24({}), null);
});

// --- normalizeTrackingMore ---------------------------------------------------

test('normalizeTrackingMore maps a v4 tracking object', () => {
  const t = normalizeTrackingMore(tmTracking);
  assert.equal(t.provider, 'trackingmore');
  assert.equal(t.status, 'available_for_pickup');
  assert.equal(t.courier, 'aramex');
  assert.equal(t.origin, 'US');
  assert.equal(t.destination, 'AE');
  assert.deepEqual(t.eta, { date: '2024-05-03', from: null, to: null });
  assert.equal(t.deliveredAt, null);
  assert.equal(t.ref.id, 'abc123');
});

test('normalizeTrackingMore merges origin and destination checkpoints, drops duplicates, newest first, ISO times', () => {
  const t = normalizeTrackingMore(tmTracking);
  assert.equal(t.events.length, 3);
  assert.deepEqual(t.events[0], { time: '2024-05-03T09:15', text: 'Ready for collection at Aramex Dubai', location: 'Dubai, AE', milestone: 'available_for_pickup' });
  assert.equal(t.events[1].text, 'Arrived in destination country');
  assert.equal(t.events[2].text, 'Shipment picked up');
  assert.equal(t.events[2].milestone, 'in_transit');
});

const tmStatusCases = [
  ['inforeceived', 'inforeceived001', 'info_received'],
  ['transit', 'transit001', 'in_transit'],
  ['pickup', 'pickup001', 'out_for_delivery'],
  ['pickup', 'pickup003', 'out_for_delivery'],
  ['pickup', 'pickup002', 'available_for_pickup'],
  ['undelivered', 'undelivered002', 'failed_attempt'],
  ['delivered', 'delivered001', 'delivered'],
  ['exception', 'exception005', 'exception'],
  ['expired', 'expired001', 'expired'],
  ['notfound', 'notfound002', 'pending'],
  ['pending', 'pending001', 'pending'],
  ['pickup', null, 'out_for_delivery'],
];
for (const [status, sub, expected] of tmStatusCases) {
  test(`normalizeTrackingMore maps ${status}/${sub} -> ${expected}`, () => {
    const t = normalizeTrackingMore({ ...tmTracking, delivery_status: status, substatus: sub, origin_info: null, destination_info: null });
    assert.equal(t.status, expected);
    assert.deepEqual(t.events, []);
  });
}

test('normalizeTrackingMore takes the delivered time from the milestone dates, else the delivered event', () => {
  const a = normalizeTrackingMore({ ...tmTracking, delivery_status: 'delivered', substatus: 'delivered001', origin_info: { ...tmTracking.origin_info, milestone_date: { delivery_date: '2024-05-04 15:30' } } });
  assert.equal(a.deliveredAt, '2024-05-04T15:30');
  const b = normalizeTrackingMore({ ...tmTracking, delivery_status: 'delivered', substatus: 'delivered001', signed_by: 'K. Kalbat', origin_info: { trackinfo: [{ checkpoint_date: '2024-05-04 16:00', checkpoint_delivery_status: 'delivered', tracking_detail: 'Delivered', location: 'Dubai' }] }, destination_info: null });
  assert.equal(b.deliveredAt, '2024-05-04T16:00');
  assert.equal(b.signedBy, 'K. Kalbat');
});

// --- fetchTracking: TrackingMore --------------------------------------------

test('TrackingMore: new shipment detects the courier, creates the tracking and returns realtime results', async () => {
  const f = fakeFetch([
    { match: '/v4/couriers/detect', method: 'POST', body: { meta: { code: 200 }, data: [{ courier_code: 'aramex', courier_name: 'Aramex' }] } },
    { match: '/v4/trackings/create', method: 'POST', body: { meta: { code: 200 }, data: tmTracking } },
  ]);
  const t = await fetchTracking(tmSettings, { number: '47473387872', carrier: null }, f);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].init.headers['Tracking-Api-Key'], 'TMKEY');
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { tracking_number: '47473387872' });
  assert.equal(JSON.parse(f.calls[1].init.body).courier_code, 'aramex');
  assert.equal(t.status, 'available_for_pickup');
  assert.equal(t.ref.id, 'abc123');
  assert.ok(t.fetchedAt);
});

test('TrackingMore: a shipment already registered is only fetched', async () => {
  const f = fakeFetch([{ match: '/v4/trackings/get?tracking_numbers=47473387872', body: { meta: { code: 200 }, data: [tmTracking] } }]);
  const t = await fetchTracking(tmSettings, { number: '47473387872', carrier: 'aramex', ref: { id: 'abc123' } }, f);
  assert.equal(f.calls.length, 1);
  assert.equal(t.status, 'available_for_pickup');
});

test('TrackingMore: a registered shipment that vanished server-side is created again', async () => {
  const f = fakeFetch([
    { match: '/v4/trackings/get', body: { meta: { code: 200 }, data: [] } },
    { match: '/v4/trackings/create', method: 'POST', body: { meta: { code: 200 }, data: tmTracking } },
  ]);
  const t = await fetchTracking(tmSettings, { number: '47473387872', carrier: 'aramex', ref: { id: 'old' } }, f);
  assert.equal(f.calls.length, 2);
  assert.equal(t.ref.id, 'abc123');
});

test('TrackingMore: create answering "already exists" (4101) falls back to get', async () => {
  const f = fakeFetch([
    { match: '/v4/trackings/create', method: 'POST', status: 400, body: { meta: { code: 4101, message: 'Tracking No. already exists.' } } },
    { match: '/v4/trackings/get', body: { meta: { code: 200 }, data: [tmTracking] } },
  ]);
  const t = await fetchTracking(tmSettings, { number: '47473387872', carrier: 'aramex' }, f);
  assert.equal(f.calls.length, 2);
  assert.equal(t.status, 'available_for_pickup');
});

test('TrackingMore: a carrier chosen by the user skips detection', async () => {
  const f = fakeFetch([{ match: '/v4/trackings/create', method: 'POST', body: { meta: { code: 200 }, data: { ...tmTracking, courier_code: 'usps' } } }]);
  await fetchTracking(tmSettings, { number: '9400111899562537624326', carrier: 'usps' }, f);
  assert.equal(f.calls.length, 1);
  assert.equal(JSON.parse(f.calls[0].init.body).courier_code, 'usps');
});

test('TrackingMore: undetectable courier is a clear error', async () => {
  const f = fakeFetch([{ match: '/v4/couriers/detect', method: 'POST', body: { meta: { code: 200 }, data: [] } }]);
  await assert.rejects(() => fetchTracking(tmSettings, { number: 'ABC123456XYZ', carrier: null }, f), /carrier/i);
});

test('TrackingMore: a bad key is reported as such', async () => {
  const f = fakeFetch([{ match: '/v4/', status: 401, body: { meta: { code: 401, message: 'Authentication failed' } } }]);
  await assert.rejects(() => fetchTracking(tmSettings, { number: '47473387872', carrier: 'aramex', ref: { id: 'x' } }, f), /API key/);
});

test('TrackingMore: quota exhaustion is reported as such', async () => {
  const f = fakeFetch([{ match: '/v4/trackings/create', method: 'POST', status: 400, body: { meta: { code: 4190, message: 'You are reaching the maximum quota limitation' } } }]);
  await assert.rejects(() => fetchTracking(tmSettings, { number: '47473387872', carrier: 'aramex' }, f), /quota/i);
});

// --- fetchTracking: Ship24 ---------------------------------------------------

test('Ship24: per-shipment plan posts to trackers/track with a bearer key', async () => {
  const f = fakeFetch([{ match: '/public/v1/trackers/track', method: 'POST', body: ship24Example }]);
  const t = await fetchTracking(s24Settings, { number: '9400115901047177598206', carrier: 'usps' }, f);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer S24KEY');
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { trackingNumber: '9400115901047177598206' });
  assert.equal(t.status, 'delivered');
  assert.equal(t.ref.trackerId, '26148317-7502-d3ac-44a9-546d240ac0dd');
});

test('Ship24: per-call plan posts to tracking/search instead', async () => {
  const f = fakeFetch([{ match: '/public/v1/tracking/search', method: 'POST', body: ship24Example }]);
  const t = await fetchTracking({ ...s24Settings, ship24Plan: 'per-call' }, { number: '9400115901047177598206' }, f);
  assert.equal(f.calls.length, 1);
  assert.equal(t.status, 'delivered');
});

test('Ship24: errors carry the API message', async () => {
  const f = fakeFetch([{ match: '/public/v1/trackers/track', method: 'POST', status: 401, body: { errors: [{ code: 'unauthorized', message: 'Invalid API key' }] } }]);
  await assert.rejects(() => fetchTracking(s24Settings, { number: '9400115901047177598206' }, f), /API key/);
});

test('an unknown provider or missing key fails before any request', async () => {
  const f = fakeFetch([]);
  await assert.rejects(() => fetchTracking({ provider: 'none', apiKey: '' }, { number: '1' }, f), /provider/i);
  await assert.rejects(() => fetchTracking({ provider: 'ship24', apiKey: '' }, { number: '1' }, f), /key/i);
  assert.equal(f.calls.length, 0);
});

// --- testKey -----------------------------------------------------------------

test('testKey reports ok for a working key and the message for a rejected one', async () => {
  const good = fakeFetch([{ match: '/v4/couriers/all', body: { meta: { code: 200 }, data: [{ courier_code: 'usps' }] } }]);
  assert.deepEqual(await testKey(tmSettings, good), { ok: true, message: 'Key works' });
  const bad = fakeFetch([{ match: '/v4/couriers/all', status: 401, body: { meta: { code: 401, message: 'Authentication failed' } } }]);
  const r = await testKey(tmSettings, bad);
  assert.equal(r.ok, false);
  assert.match(r.message, /API key/);
  const s24 = fakeFetch([{ match: '/public/v1/couriers', body: { data: { couriers: [{ courierCode: 'us-post' }] } } }]);
  assert.equal((await testKey(s24Settings, s24)).ok, true);
});
