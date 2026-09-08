# Style lock — ShipTrack

Locked 2026-09-08 after the owner rejected the first (kraft label) world. Mode: Operate. Design read: personal parcel board for one owner on phone and desktop, delivery-app live-sheet lane, dials variance 4 / motion 3 / density 6 / art direction 6.

## Palette (runtime light + dark toggle, system default)

Achromatic neutrals (zero chroma, deliberately) plus status colors. Values live in `styles.css` `:root` and are the only source; DESIGN.md lists them.

Color contract (checked as used):
- Text-safe on sheets: ink/sheet, ink-2/sheet, ink-3/sheet, each status `-ink` on its sheet and on its `-tint`, bg text on ink buttons.
- UI-safe: status base colors as dots, pips and rail fills against sheets.
- Decorative: `--line`, `--line-strong`, `--sheet-border`.

## Type

Onest (400/500/600/700) for UI, Red Hat Mono (400/500) for numbers. No third family.

## Density & spacing

App shell density. 4px unit; card padding 16/18; list gap 12; sidebar rows 9/12. Section separation: whitespace only.

## Assets

Authored SVG mark (`icons/icon.svg`, route from origin dot to live dot) rendered to PNG by Playwright. Icons: inline Lucide-style symbols in `index.html`, one stroke weight (1.8). No photography, no illustration: none belongs on an operate surface.

## Do not

- Kraft/cardboard, stripes, stamps, condensed display type, uppercase mono labels, hard offset shadows (all rejected with v1).
- Brand blue on chrome; color means status only.
