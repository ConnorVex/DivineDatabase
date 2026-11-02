import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import preact from '@astrojs/preact';

// The Divine Database: character, evolution, equipment and family submissions for Singularity.
// Its rules live on the Singularity Index (https://connorvex.github.io/SingularityV5/).
export default defineConfig({
	site: 'https://connorvex.github.io',
	base: '/DivineDatabase',
	integrations: [
		preact(),
		starlight({
			title: 'Divine Database',
			logo: { src: './src/assets/singularity-logo.webp' },
			favicon: '/favicon.svg',
			pagefind: false,
			tableOfContents: false,
			pagination: false,
			customCss: ['@fontsource-variable/exo-2', './src/styles/site.css'],
		}),
	],
});
