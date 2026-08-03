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

  // Derrière Coolify/Cloudflare : Origin https ≠ url interne http → 403 CSRF
  security: {
    checkOrigin: true,
    allowedDomains: [
      { hostname: 'sonozz.briseteia.me', protocol: 'https' },
      { hostname: 'localhost', protocol: 'http' },
      { hostname: '127.0.0.1', protocol: 'http' },
    ],
  },

  vite: {
    plugins: [tailwindcss()]
  },

  adapter: node({
    mode: 'standalone'
  })
});
