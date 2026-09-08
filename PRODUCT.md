# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Static HTML/CSS/ES modules on GitHub Pages, no build step, no framework (existing codebase). Tracking APIs are called directly from the browser.

## Users

One person: the site owner, who orders from US, UK and Chinese stores (eBay, Shopify "Shop" stores, Amazon, AliExpress) and receives parcels in the UAE through Shop & Ship / Aramex, Emirates Post, USPS, UPS, FedEx and DHL. Uses the site on a phone during the day (checking "is it here yet?") and on a Windows desktop at work. (Inferred from the brief and the carrier list; not interviewed.)

## Product Purpose

One board for every incoming parcel. Paste a tracking number or the link from a shipping email; the site works out the carrier, shows the live status, latest scan, carrier ETA and the full event trail, and lets the owner note what the parcel is, which store it came from, and anything else worth remembering. Success: a glance answers "what is arriving, and when?" without opening five carrier sites.

## Positioning

Every carrier in one place with no account and no backend: tracking data comes from a service the owner connects once (Ship24, free plan), and all parcel data plus the key live only in the browser. Carrier deep links keep it useful even with no key.

## Operating Context

- Numbers arrive by copy-paste from order pages, shipping emails and the Shop app; often as a URL.
- Parcels are checked several times a day while in transit; delivered ones are looked at once and then archived.
- Statuses that matter most: arriving today, ready for pickup (Aramex / Shop & Ship counters), failed delivery attempt, and no scans yet.
- Tracking services need a minute after a number is added before the carrier data appears; refreshes are free on the per-shipment plan.

## Capabilities and Constraints

- Carrier detection from the number format: USPS, UPS, FedEx, DHL, Aramex / Shop & Ship, Emirates Post, Amazon, Cainiao, Yun Express, China Post and other postal services by S10 suffix; a manual carrier override per parcel.
- Live tracking through Ship24 (recommended, free tier) or TrackingMore (paid API). Unified statuses: pending, info received, in transit, out for delivery, failed attempt, available for pickup, delivered, exception, expired.
- Per-parcel item name, store, notes; Active / Delivered / All filters; archive; export/import JSON; one-time setup links that store the key on a device; installable PWA with an offline shell.
- Everything is stored in localStorage; nothing is sent anywhere except the chosen tracking service.
- Ship24 free plan: 10 shipments a month. Refreshes must stay cheap; delivered parcels are never refreshed.
- Undecided: whether more than one device should share the same parcel list (currently each device keeps its own).

## Brand Commitments

Name: ShipTrack. No logo or palette is binding; the previous kraft-label look was rejected by the owner and is being replaced. Voice: plain, direct, second person, no hype.

## Evidence on Hand

- Working code: `index.html`, `app.js`, `carriers.js`, `providers.js`, `format.js`, `styles.css`, tests under `tests/`.
- No screenshots of real parcels, no testimonials, no metrics. Demonstration data used in screenshots must be labelled as sample data.

## Product Principles

- Arrival first: the answer to "when?" is the most important thing on every card.
- Color means status, never decoration.
- Nothing to learn: paste, read, done. Details are one tap away, never in the way.
- Works with no key, gets better with one.
- Honest about uncertainty: "no scans yet" and "no estimate" are real states, shown plainly.
