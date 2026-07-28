# App icons

Drop your generated PNG icons here. The manifest in `vite.config.ts` expects:

| File                     | Size    | Purpose   |
| ------------------------ | ------- | --------- |
| `pwa-192.png`            | 192×192 | any       |
| `pwa-512.png`            | 512×512 | any       |
| `pwa-maskable-512.png`   | 512×512 | maskable  |

Fast way to generate all sizes from one source image:

```bash
npx pwa-asset-generator ./logo.png ./public/icons \
  --background "#0a0a0a" --padding "18%" --icon-only
```

Then confirm the filenames match the `manifest.icons` entries in `vite.config.ts`.
