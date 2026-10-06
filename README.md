# Bin Bench

Design custom 3D-printed drawer organizers in the browser. Lay out bins and dividers on a
to-scale drawing of a drawer, preview them in 3D, and download ready-to-print 3MF/STL files.

## Stack

| Layer         | Choice                                                                   |
| ------------- | ------------------------------------------------------------------------ |
| Framework     | Astro 6 + TypeScript (static output)                                      |
| Styling       | Tailwind CSS v4 + DaisyUI 5                                               |
| Interactivity | React islands — only the designer (`/app`) and the mobile nav             |
| Hosting       | Vercel Pro, deployed from GitHub                                          |
| Domains / DNS | Cloudflare Registrar (registered in the client's name), CNAME → Vercel   |

**Build pin:** `package.json` has an `"overrides": { "vite": "^7.3.2" }` entry. Without it the
React and Tailwind plugins pull in Vite 8, which conflicts with Astro 6. Don't remove it.

## Commands

```sh
npm install
npm run dev       # http://localhost:4321
npm run build     # astro check + static build into dist/
npm run preview   # serve dist/ locally
```

## Layout

```
src/
  pages/                 index, how-it-works, faq, app (the designer), 404
  layouts/               BaseLayout (light "binbench" theme), AppLayout (dark "workbench" theme)
  components/site/       header, footer, logo, MobileNav (React island)
  components/binbench/   the designer, as React components
    BinBenchApp.tsx        root: project state, file save/open, shortcuts
    DrawerCanvas.tsx       interactive SVG grid (draft / move / resize / dividers)
    BinEditor.tsx          floating bin editor
    Preview3D.tsx          three.js preview
    PlatePanels.tsx        plate packing + baseplate sections
    SettingsPanels.tsx     sidebar settings
    ListPanels.tsx         bins / obstructions / shelved lists
    Tour.tsx               guided tutorial
  lib/binbench/          framework-free engine (pure TypeScript)
    model.ts               types, layout + stacking rules
    geometry.ts            bin meshes, baseplate lattice, tiling, stacked plates, packing
    exporters.ts           STL / 3MF (+ Bambu Studio plate tagging)
    project-io.ts          project JSON save + load (reads every legacy format)
    template.ts            1:1 paper template
  styles/global.css      Tailwind + DaisyUI themes
bin-bench.html           the original single-file tool, kept for reference
```

The engine in `src/lib/binbench` is a straight port of the original `bin-bench.html`. Its geometry
output (bin meshes, baseplate tiles, plate packing, stacked plates) was checked against the
original and matches exactly. Keep that code free of DOM and React so it stays testable.

The designer is mounted with `client:only="react"` since it needs `window`, WebGL and the File
System Access API. Every other page is static HTML with zero JavaScript, except the mobile nav,
which hydrates only below the `md` breakpoint.

## Deploying

### Vercel (Pro: Hobby doesn't allow commercial use)

1. Push this repo to GitHub.
2. In Vercel: **Add New → Project → Import** the repo. The Astro preset is detected
   automatically (build `npm run build`, output `dist`). No adapter is needed since the site is
   fully static.
3. Every push to `main` deploys to production; every PR gets a preview URL.

### Domain (Cloudflare Registrar → Vercel)

1. Register the domain in Cloudflare **under the client's own account/name**.
2. In Vercel: **Project → Settings → Domains → Add** both `example.com` and `www.example.com`
   (pick one as primary; Vercel redirects the other).
3. In Cloudflare **DNS**, add the records Vercel shows, typically:
   - `www` → `CNAME` → `cname.vercel-dns.com`
   - apex `@` → `CNAME` → `cname.vercel-dns.com` (Cloudflare flattens apex CNAMEs automatically)
4. Set those records to **DNS only** (grey cloud), not proxied, so Vercel can issue and renew
   the TLS certificate and its edge network works as intended.
5. Update `site` in `astro.config.mjs` to the real domain (used for canonical and OG URLs).
