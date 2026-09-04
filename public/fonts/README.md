# Self-hosted webfonts

Four files, downloaded from Google's CDN on 2026-09-03 and served from this
origin ever since.

## Why they are here rather than on `fonts.googleapis.com`

`/legal/cookies` says, in bold:

> **There are no cookies, no analytics and no advertising.** No third-party
> script runs on this site.

and `src/lib/legalFacts.ts` repeats it. That was not true while every page
loaded a stylesheet from `fonts.googleapis.com` and four font files from
`fonts.gstatic.com`: every visitor's IP address and User-Agent reached Google
before they had interacted with anything, on a site whose sub-processor list
does not mention Google at all. A German court has fined a site operator for
exactly this arrangement.

The claim is the thing worth keeping, so the fonts moved rather than the
sentence.

## What is here

| File | Family | Subset | Axis |
| --- | --- | --- | --- |
| `inter-latin.woff2` | Inter | latin | variable, 100–900 |
| `inter-latin-ext.woff2` | Inter | latin-ext | variable, 100–900 |
| `jetbrains-mono-latin.woff2` | JetBrains Mono | latin | variable, 100–800 |
| `jetbrains-mono-latin-ext.woff2` | JetBrains Mono | latin-ext | variable, 100–800 |

Both families are variable, so one file per subset covers every weight
`docs/DESIGN.md` specifies. JetBrains Mono's three declared weights
(400/500/700) were already being served by Google as one variable file.

Cyrillic, Greek and Vietnamese subsets are deliberately not shipped: this is a
UK product with English-only copy, and they are 60% of the download.

## Licences

Both are SIL Open Font License 1.1, which permits redistribution and hosting.
Inter © The Inter Project Authors; JetBrains Mono © The JetBrains Mono Project
Authors.

## Replacing them

`@font-face` lives in `src/index.css`. The `unicode-range` values are Google's
own, copied from the stylesheet it serves, and are what let the browser skip
the `latin-ext` file for text that does not need it.
