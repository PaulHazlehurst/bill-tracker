# Fonts

Served from the app itself (through `next/font/local` in `app/layout.tsx`)
instead of from Google Fonts, so pages don't wait on a second website before
showing text, and the stand-in font is sized to match so nothing jumps when
the real one arrives.

| File | Font | Source | Licence |
|---|---|---|---|
| bricolage-grotesque-latin-standard-normal.woff2 | Bricolage Grotesque (weight, width and optical size axes) | @fontsource-variable/bricolage-grotesque 5.3.0 | SIL Open Font License 1.1 |
| instrument-sans-latin-standard-normal.woff2 | Instrument Sans (weight and width axes) | @fontsource-variable/instrument-sans 5.3.0 | SIL Open Font License 1.1 |
| geist-mono-latin-wght-normal.woff2 | Geist Mono (weight axis) | @fontsource-variable/geist-mono 5.3.0 | SIL Open Font License 1.1 |

Latin characters only, which covers English text and common punctuation.
