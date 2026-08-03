// @ts-check
import { defineConfig } from 'astro/config';

import preact from '@astrojs/preact';
import tailwindcss from '@tailwindcss/vite';

import node from '@astrojs/node';

// https://astro.build/config
export default defineConfig({
  site: 'https://sonozz.briseteia.me',
  output: 'server',
  integrations: [preact()],

  build: {
    // Évite /_astro (souvent coincé en 404 cache Cloudflare après redeploy)
    assets: 'assets',
  },

  vite: {
    plugins: [tailwindcss()]
  },

  adapter: node({
    mode: 'standalone'
  })
});
