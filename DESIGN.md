# ShipTrack design system

Recorded from the built surface (2026-09-08). Direction seed 87475106, candidate 6 of 7: the delivery-app live sheet.

## World

Arrival first. Every card leads with the answer to "when?" in a 26px line. Chrome is achromatic; color appears only where it means status. The audience reads Careem, Talabat and Uber tracking sheets daily, and this borrows that grammar: soft canvas, white sheets with big radii, a route rail with a live dot, a stepper drawn in full even when unreached, and the primary input in the thumb zone on phones.

## Tokens (see `styles.css` `:root`)

- Canvas `--bg` #f3f3f5 (dark #0f0f11); sheets `--sheet` #ffffff (dark #1a1a1e); inset `--sheet-2`.
- Ink `--ink` #111114 / `--ink-2` #5c5c66 / `--ink-3` #74747e. Dark: #f2f2f4 / #a6a6af / #85858e. All text pairings clear 4.5:1 on their sheet.
- Status: `live` blue (#3b82f6, text #2563eb light / #6aaaff dark), `done` green, `warn` amber, `bad` red, `idle` gray. Each has a `-tint` for chips and rings. In transit with no near arrival wears plain ink.
- Elevation, declared once per theme: light sheets carry a soft offset shadow and no border; dark sheets carry a 1px hairline and no shadow.
- Radii: sheets 20px, controls 12px, chips pill. Spacing on a 4px unit: 2/4/6/8/10/12/14/16/18/20/22/28.
- Type: Onest 400–700 for everything, tabular figures on; Red Hat Mono for tracking numbers and route codes only. Arrival line 26px/600, -0.02em. Title 16px/600. Body 14px. Meta 13px. Rail labels 11px.

## Components

- **Shell**: 264px sidebar (brand, status summary with dots, filter nav with counts, refresh + settings) at ≥960px; top bar, one-line summary and a segmented filter below that.
- **Composer**: the paste field. Fixed to the bottom with a frosted bar on phones; static at the top of the column on desktop. Paste submits automatically, never blocked.
- **Card**: chip (status, pulsing dot when out for delivery or ready for pickup) + carrier · store; title; arrival headline + detail; route rail (origin code, four stops, destination code; fill and pips in the status color; unreached stops are ghosts); latest scan with a pin; notes inset; footer with the mono number (tap to copy) and ghost actions (Trail, carrier link, Refresh, Edit/Details, Archive).
- **States**: skeleton while the first fetch runs; "Not tracked yet" with a settings link when no key; inline red error line with the API message; empty board with carrier chips; "Nothing on the way" for an empty filter.
- **Settings**: dialog at 22px radius; provider as option rows; key field with Show/Test; Ship24 plan as a segmented control; theme select; export/import; destructive action isolated at the right.

## Motion

Cards enter with a 220ms fade/6px rise staggered 28ms. The live dot rings every 2.4s on out-for-delivery and pickup cards. Rail fill scales in over 300ms. Buttons transition color 150ms and press to 0.98. Reduced motion removes the entrance, the ring and the fill transition.

## Do not

- No brand accent on chrome; blue is for "happening now", not buttons or links.
- No hard offset shadows, no stripes or textures on the canvas, no uppercase mono labels, no condensed display type (the rejected first version).
- Never animate width, height or box-shadow.
