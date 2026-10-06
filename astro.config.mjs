// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// TODO: set `site` to the production domain once it's registered (Cloudflare -> Vercel CNAME).
export default defineConfig({
  site: 'https://binbench.example.com',
  integrations: [react()],
  // the floating dev toolbar sits right over the designer's bin editor buttons
  devToolbar: { enabled: false },
  vite: {
    plugins: [tailwindcss()],
    // three.js alone is ~600 kB; it only loads on /app
    build: { chunkSizeWarningLimit: 900 },
  },
});
