import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCarrier, extractNumbers, trackingUrl, looksLikeOrderNumber, orderRefFrom, CARRIERS } from '../carriers.js';

test('orderRefFrom pulls the bare order number out of the usual ways people write it', () => {
  assert.equal(orderRefFrom('14431'), '14431');
  assert.equal(orderRefFrom('#14431'), '14431');
  assert.equal(orderRefFrom('Order #1004'), '1004');
  assert.equal(orderRefFrom('  order 2201567 '), '2201567');
  assert.equal(orderRefFrom('1Z999AA10123456784'), null);
  assert.equal(orderRefFrom('hello'), null);
  assert.equal(orderRefFrom(''), null);
});

// --- looksLikeOrderNumber: a store order number pasted instead of a tracking number ---

test('looksLikeOrderNumber spots short store order numbers', () => {
  assert.equal(looksLikeOrderNumber('14431'), true);
  assert.equal(looksLikeOrderNumber('#14431'), true);
  assert.equal(looksLikeOrderNumber('Order #1004'), true);
  assert.equal(looksLikeOrderNumber('order 2201567'), true);
});

test('looksLikeOrderNumber leaves real tracking numbers and junk alone', () => {
  assert.equal(looksLikeOrderNumber('1Z999AA10123456784'), false);
  assert.equal(looksLikeOrderNumber('123456789012'), false);
  assert.equal(looksLikeOrderNumber('hello there'), false);
  assert.equal(looksLikeOrderNumber(''), false);
});

// --- detectCarrier -----------------------------------------------------------

const cases = [
  ['1Z999AA10123456784', 'ups'],
  ['9400111899562537624326', 'usps'],   // 22-digit IMpb
  ['9205590164917312751089', 'usps'],
  ['LZ123456789US', 'usps'],            // S10 from the US
  ['EE013142149AE', 'emirates-post'],   // S10 from the UAE
  ['RR123456789CN', 'china-post'],
  ['RB123456789GB', 'royal-mail'],
  ['123456789012', 'fedex'],            // 12-digit Express
  ['123456789012345', 'fedex'],         // 15-digit Ground
  ['9612019012345678901234', 'fedex'],  // 22-digit SmartPost starts 96
  ['47473387872', 'aramex'],            // 11 digits: Aramex / Shop & Ship
  ['TBA123456789012', 'amazon'],
  ['JD014600004296612345', 'dhl'],
  ['LP00123456789012', 'cainiao'],
  ['YT1234567890123456', 'yunexpress'],
];

for (const [number, key] of cases) {
  test(`detectCarrier(${number}) -> ${key}`, () => {
    const hit = detectCarrier(number);
    assert.ok(hit, 'expected a carrier');
    assert.equal(hit.key, key);
  });
}

test('10 digits is DHL Express first with Aramex as the alternative', () => {
  const hit = detectCarrier('1234567890');
  assert.equal(hit.key, 'dhl');
  assert.deepEqual(hit.alternatives, ['aramex']);
});

test('unknown S10 country falls back to a generic postal carrier', () => {
  const hit = detectCarrier('RR123456789ZZ');
  assert.equal(hit.key, 'intl-post');
});

test('gibberish is not a carrier', () => {
  assert.equal(detectCarrier('hello'), null);
  assert.equal(detectCarrier(''), null);
});

test('detection ignores spaces, dashes and case', () => {
  assert.equal(detectCarrier('9400 1118 9956 2537 6243 26').key, 'usps');
  assert.equal(detectCarrier('1z999aa1-0123456784').key, 'ups');
});

// --- extractNumbers ----------------------------------------------------------

const urlCases = [
  ['https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899562537624326', ['9400111899562537624326']],
  ['https://www.aramex.com/us/en/track/results?ShipmentNumber=47473387872', ['47473387872']],
  ['https://www.fedex.com/fedextrack/?trknbr=123456789012', ['123456789012']],
  ['https://www.ups.com/track?loc=en_US&tracknum=1Z999AA10123456784&requester=ST/trackdetails', ['1Z999AA10123456784']],
  ['https://t.17track.net/en#nums=EE013142149AE', ['EE013142149AE']],
  ['https://emiratespost.ae/Portal/Track?TrackingNumber=EE013142149AE&locale=en-us', ['EE013142149AE']],
  ['https://www.dhl.com/global-en/home/tracking.html?tracking-id=1234567890', ['1234567890']],
  ['https://parcelsapp.com/en/tracking/RR123456789CN', ['RR123456789CN']],
];

for (const [input, expected] of urlCases) {
  test(`extractNumbers pulls the number out of ${new URL(input).hostname}`, () => {
    assert.deepEqual(extractNumbers(input), expected);
  });
}

test('extractNumbers splits lists on commas and newlines and strips spaces', () => {
  const input = '1Z999AA10123456784, EE013142149AE\n9400 1118 9956 2537 6243 26';
  assert.deepEqual(extractNumbers(input), ['1Z999AA10123456784', 'EE013142149AE', '9400111899562537624326']);
});

test('extractNumbers finds a number inside free text', () => {
  assert.deepEqual(extractNumbers('Your order shipped! Tracking: 1Z999AA10123456784. Thanks'), ['1Z999AA10123456784']);
});

test('extractNumbers keeps an unrecognised but plausible code so the API can try it', () => {
  assert.deepEqual(extractNumbers('ABC123456XYZ'), ['ABC123456XYZ']);
});

test('extractNumbers drops duplicates and empty input', () => {
  assert.deepEqual(extractNumbers('1Z999AA10123456784 1Z999AA10123456784'), ['1Z999AA10123456784']);
  assert.deepEqual(extractNumbers('   '), []);
});

// --- trackingUrl -------------------------------------------------------------

test('trackingUrl builds the carrier deep link', () => {
  assert.equal(trackingUrl('usps', '9400111899562537624326'), 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899562537624326');
  assert.equal(trackingUrl('aramex', '47473387872'), 'https://www.aramex.com/track/results?ShipmentNumber=47473387872');
  assert.equal(trackingUrl('emirates-post', 'EE013142149AE'), 'https://emiratespost.ae/Portal/Track?TrackingNumber=EE013142149AE&locale=en-us');
  assert.equal(trackingUrl('ups', '1Z999AA10123456784'), 'https://www.ups.com/track?tracknum=1Z999AA10123456784');
  assert.equal(trackingUrl('fedex', '123456789012'), 'https://www.fedex.com/fedextrack/?trknbr=123456789012');
});

test('trackingUrl falls back to 17TRACK for unknown carriers', () => {
  assert.equal(trackingUrl('nope', 'ABC123'), 'https://t.17track.net/en#nums=ABC123');
  assert.equal(trackingUrl(null, 'ABC123'), 'https://t.17track.net/en#nums=ABC123');
});

test('every carrier has a name and a track url builder', () => {
  for (const [key, c] of Object.entries(CARRIERS)) {
    assert.ok(c.name, `${key} needs a name`);
    assert.match(trackingUrl(key, 'X1'), /^https:\/\//, `${key} needs an https deep link`);
  }
});
