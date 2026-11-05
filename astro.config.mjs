import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import preact from '@astrojs/preact';

// The Divine Database: character, evolution, equipment and family submissions for Singularity.
// Its rules live on the Singularity Index (https://index.singularityeco.us/).
// Maintenance mode: a gate on every page (src/maintenance-gate.ts). The inline part hides the page
// before it paints for visitors whose last check said maintenance was on, so they don't glimpse it.
const maintenanceGate = {
	name: 'maintenance-gate',
	hooks: {
		'astro:config:setup': ({ injectScript }) => {
			injectScript(
				'head-inline',
				"try{if(localStorage.getItem('dd-maintenance')==='1'){document.documentElement.classList.add('mnt-hold');var s=document.createElement('style');s.textContent='html.mnt-hold body{visibility:hidden}';document.head.appendChild(s);setTimeout(function(){document.documentElement.classList.remove('mnt-hold')},4000)}}catch(e){}",
			);
			injectScript('page', "import '/src/maintenance-gate.ts';");
		},
	},
};

export default defineConfig({
	site: 'https://database.singularityeco.us',
	integrations: [
		maintenanceGate,
		preact(),
		starlight({
			title: 'Divine Database',
			logo: { src: './src/assets/singularity-logo.webp' },
			favicon: '/favicon.png',
			pagefind: false,
			tableOfContents: false,
			pagination: false,
			customCss: ['@fontsource-variable/exo-2', './src/styles/site.css'],
		}),
	],
});
