# App icons

These are **generated from the vector mark**, not hand-exported. The geometry
lives in one place — `src/components/ui/BrandMark.tsx` — and `public/favicon.svg`
carries the same paths, so the tab icon, the installed-app icon and the in-app
sidebar mark cannot drift apart.

| File                   | Size    | Purpose  | Notes                                    |
| ---------------------- | ------- | -------- | ---------------------------------------- |
| `pwa-192.png`          | 192×192 | any      | Full-bleed brand tile                    |
| `pwa-512.png`          | 512×512 | any      | Full-bleed brand tile                    |
| `pwa-maskable-512.png` | 512×512 | maskable | Mark inset to 66% for the Android crop    |

`vite.config.ts` → `manifest.icons` expects exactly these filenames.

## Regenerating

Do not hand-edit these PNGs. If the mark changes, change `BrandMark.tsx` and
`favicon.svg` together, then re-render the PNGs from that geometry at 192, 512
and 512-maskable. The maskable variant must keep the mark inside the ~80% safe
zone or Android's circular crop will clip the R's leg.
