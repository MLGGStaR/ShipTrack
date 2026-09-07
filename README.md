# ShipTrack

One board for every parcel. Paste a tracking number (or the link from a shipping email), see where it is and when it lands, and note what you ordered.

Live site: https://mlggstar.github.io/ShipTrack/

## What it does

- Paste a number or link; the carrier is detected from the number format (USPS, UPS, FedEx, DHL, Aramex / Shop & Ship, Emirates Post, Amazon, Cainiao, Yun Express, China Post and other postal services by their S10 code).
- Live status, latest scan, carrier ETA and the full event list come from a tracking service you connect once in Settings. Both have free plans:
  - **TrackingMore**: 50 shipments a month free. Refreshing is free.
  - **Ship24**: 10 shipments a month free on the per-shipment plan, or 100 calls a month on the per-call plan.
- Every card has "Open on <carrier>" and 17TRACK links, so it stays useful with no key at all.
- Add what the parcel is, which store it came from (Shop, eBay, Amazon, ...) and any notes. Delivered parcels can be archived.
- Installable as a PWA (works offline for the board; live updates need a connection).

## Setup

1. Open the site, tap the gear icon.
2. Pick TrackingMore or Ship24, follow the "Get a key" link, sign up for the free plan and paste the key. Tap **Test**, then **Save**.
3. Paste a tracking number. Done.

The key and all parcel data stay in the browser's local storage. Nothing is sent anywhere except the tracking service you chose. Use **Export JSON** in Settings before switching phones.

## Running locally

Any static server works. For example:

```
python -m http.server 8080
```

Then open http://localhost:8080/. The tracking APIs allow browser requests from any origin, so no proxy is needed.

## Tests

```
node --test tests/*.test.mjs
```

Covers carrier detection and number extraction from links, both API adapters (against the documented response shapes, using a fake `fetch`), and the date and stamp copy helpers.

## Files

| File | Role |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | The board: storage, add and refresh flows, rendering |
| `carriers.js` | Carrier detection, deep links, number extraction |
| `providers.js` | TrackingMore and Ship24 adapters, normalised to one status model |
| `format.js` | Dates, status labels, stamp copy |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA bits |

## Notes

- Shop (the Shopify app) and eBay are stores, not carriers. Copy the carrier tracking number from the order page and paste it here; pick the store on the card.
- Shop & Ship numbers are Aramex numbers and track through Aramex.
- Tracking services need a minute after a number is first added before the carrier data shows up. Use Refresh.
