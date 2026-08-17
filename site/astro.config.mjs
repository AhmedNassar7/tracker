// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  // Served as a GitHub Pages project site, not a user/org root site — every
  // internal link and public/ asset must be reachable under this prefix.
  // See tracker-website-plan.html §7 for why the default (unowned-domain)
  // path is ahmednassar7.github.io/tracker rather than a custom domain.
  site: 'https://ahmednassar7.github.io',
  base: '/tracker',

  integrations: [react()],

  vite: {
    plugins: [tailwindcss()]
  }
});