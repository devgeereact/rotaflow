/**
 * Renders `public/og-image.png`, the 1200x630 card every link preview shows.
 *
 * There was no Open Graph image at all until 2026-09-02 — no `og:image`, no
 * `twitter:image`, nothing — so a link to rotaflow.space pasted into Slack,
 * WhatsApp, LinkedIn or iMessage rendered as a bare grey rectangle with a
 * hostname under it. For a product sold on looking organised, that is the
 * first impression most people get before they ever load the site.
 *
 * Generated rather than drawn so it stays in step with `tailwind.config.ts`
 * and `src/lib/brand.ts`, and so the next person can change the words without
 * opening a design tool. Playwright is already a dev dependency for the e2e
 * suite; nothing new is installed for this.
 *
 * Run it deliberately, not on every build: the output is committed, because
 * the card changes about once a year and a build step that needs a browser
 * binary is a bad trade for that.
 *
 *   node scripts/generate-og-image.mjs
 */
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public/og-image.png');

// Kept in step with tailwind.config.ts by hand. A build-time import would
// drag PostCSS in for nothing.
const PRIMARY = '#3B6FE0'; // primary.DEFAULT — the rule under the card
const BRAND = '#0C60F8'; // brand.DEFAULT — the logo tile
const BRAND_LIGHT = '#4C8CFB'; // brand.light — the accent square in the mark
const INK = '#16191F'; // content.DEFAULT
const MUTED = '#6B7280'; // content.muted
const CANVAS = '#FFFFFF'; // surface.DEFAULT

/**
 * The real mark, not an approximation of it. Same geometry as
 * `src/components/ui/BrandMark.tsx`, which is itself traced from
 * `docs/design/splash-screen.png` and also generates `public/favicon.svg` and
 * the three PWA icons. A link preview showing a different R from the installed
 * app icon is the kind of near-miss that mark exists to prevent.
 */
const BRAND_MARK = `<svg viewBox="0 0 266 269" width="72" height="72" aria-hidden="true">
  <rect width="266" height="269" rx="46" fill="${BRAND}" />
  <rect x="60" y="120" width="48" height="48" rx="12" fill="${BRAND_LIGHT}" />
  <path d="M72 41H156A66 66 0 0 1 166 166L135 126A24 24 0 0 0 150 87H72A12 12 0 0 1 60 75V53A12 12 0 0 1 72 41Z" fill="#FFFFFF" />
  <path d="M86 121H134L204.3 221.8Q210 230 200 230H167Q157 230 150.9 222L81.3 130.6Q74 121 86 121Z" fill="#FFFFFF" />
  <g fill="#FFFFFF">
    <rect x="60" y="179" width="20" height="20" rx="5" />
    <rect x="89" y="179" width="20" height="20" rx="5" />
    <rect x="60" y="208" width="20" height="20" rx="5" />
    <rect x="89" y="208" width="20" height="20" rx="5" />
  </g>
</svg>`;

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
      rel="stylesheet"
    />
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        width: 1200px; height: 630px;
        background: ${CANVAS};
        font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        color: ${INK};
        display: flex; flex-direction: column; justify-content: space-between;
        padding: 72px 80px;
      }
      .rule { height: 8px; width: 96px; background: ${PRIMARY}; border-radius: 4px; }
      .brand { display: flex; align-items: center; gap: 18px; }
      .name { font-size: 34px; font-weight: 600; letter-spacing: -0.01em; }
      h1 {
        font-size: 76px; line-height: 1.05; font-weight: 700; letter-spacing: -0.03em;
        max-width: 940px; margin-top: 40px;
      }
      p { font-size: 30px; line-height: 1.4; color: ${MUTED}; max-width: 900px; margin-top: 28px; }
      footer { display: flex; align-items: center; justify-content: space-between; font-size: 24px; color: ${MUTED}; }
      .domain { font-weight: 600; color: ${INK}; }
    </style>
  </head>
  <body>
    <div>
      <div class="brand">
        ${BRAND_MARK}
        <div class="name">RotaFlow</div>
      </div>
      <h1>Scheduling certainty for every shift</h1>
      <p>
        UK-first workforce scheduling for shift-based teams. Rotas, leave, swaps
        and clock-in that keep working when the signal drops.
      </p>
    </div>
    <footer>
      <div class="rule"></div>
      <div class="domain">rotaflow.space</div>
    </footer>
  </body>
</html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'networkidle' });
// The webfont has to have painted before the screenshot, or the card ships in
// the fallback face and the line breaks land somewhere else entirely.
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: out, type: 'png' });
await browser.close();

console.log(`wrote ${path.relative(root, out)}`);
