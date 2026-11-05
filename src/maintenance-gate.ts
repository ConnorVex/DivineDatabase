// Runs on every page. In maintenance mode, anyone who isn't a logged-in admin gets the
// "we're working on it" screen instead of the site. Admins see the site with a small banner.
// If the check itself fails, the site stays open.
import { loadMaintenance, MAINTENANCE_KEY } from './lib/maintenance.ts';
import { logIn, logOut, supabase } from './lib/supabase.ts';
// Imported as text and added as a <style> tag: Astro doesn't bundle CSS imported by an injected
// page script in production builds, so a plain `import './styles/maintenance.css'` only works in dev.
import css from './styles/maintenance.css?raw';

const html = document.documentElement;
const style = document.createElement('style');
style.dataset.maintenance = '';
style.textContent = css;
document.head.append(style);
const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
const remember = (on: boolean) => {
	try {
		localStorage.setItem(MAINTENANCE_KEY, on ? '1' : '0');
	} catch {}
};
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) => {
	const node = document.createElement(tag);
	node.className = cls;
	if (text) node.textContent = text;
	return node;
};

function block(message: string, loggedIn: boolean) {
	html.classList.add('mnt-blocked');
	const screen = el('div', 'mnt-screen');
	screen.id = 'mnt-screen';
	screen.setAttribute('role', 'main');
	const card = el('div', 'mnt-card');
	card.append(
		el('div', 'mnt-icon', '🛠️'),
		el('p', 'mnt-kicker', 'Maintenance'),
		el('h1', 'mnt-title', 'We’re working on the Divine Database'),
		el('p', 'mnt-message', message || 'We’re making improvements behind the scenes.'),
		el('p', 'mnt-soon', 'It’ll be back soon. Thanks for your patience!'),
	);
	const action = el('button', 'mnt-login', loggedIn ? 'Log out' : 'Admin? Log in with Discord');
	action.type = 'button';
	action.addEventListener('click', () => (loggedIn ? logOut().then(() => location.reload()) : logIn()).catch(() => {}));
	if (loggedIn) card.append(el('p', 'mnt-note', 'You’re logged in, but only admins can use the site right now.'));
	card.append(action);
	screen.append(card);
	document.body.append(screen);
	document.title = 'Back soon · Divine Database';
}

function banner() {
	const bar = el('div', 'mnt-banner');
	bar.setAttribute('role', 'status');
	const link = el('a', '', 'Turn off');
	link.href = `${base}admin/review/?type=site`;
	bar.append(el('span', '', '🛠️ Maintenance mode is on. Only admins can see the site. '), link);
	document.body.append(bar);
}

async function run() {
	// Dev only: /any-page/?maintenance=preview shows the screen without touching the database.
	if (import.meta.env.DEV && new URLSearchParams(location.search).get('maintenance') === 'preview') {
		html.classList.remove('mnt-hold');
		return block('New character form coming tonight!', false);
	}
	let state;
	try {
		state = await loadMaintenance();
	} catch {
		state = null;
	}
	if (!state?.maintenance) {
		remember(false);
		html.classList.remove('mnt-hold');
		return;
	}
	remember(true);
	const session = supabase ? (await supabase.auth.getSession()).data.session : null;
	const admin = session && supabase ? (await supabase.rpc('is_admin')).data === true : false;
	html.classList.remove('mnt-hold');
	if (admin) banner();
	else block(state.maintenance_message, Boolean(session));
}

run();
