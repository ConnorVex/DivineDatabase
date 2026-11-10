// The Families tab of My Stuff: the family you own and your characters' families.
import { useEffect, useState } from 'preact/hooks';
import { loadMyFamilies, type MyFamilies as Data } from '../../lib/portal/home.ts';

const families = `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}families/`;
const familyHref = (slug: string) => `${families}view/?f=${encodeURIComponent(slug)}`;
const messageOf = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));

const FAMILY_STATUS = {
	pending: { label: 'In review', tone: 'info' },
	approved: { label: 'Approved', tone: 'good' },
	needs_correction: { label: 'Needs correction', tone: 'warn' },
	denied: { label: 'Denied', tone: 'bad' },
};
export function MyFamilies() {
	const [data, setData] = useState<Data | null>(null);
	const [error, setError] = useState('');
	useEffect(() => {
		loadMyFamilies().then(setData, (e) => setError(messageOf(e)));
	}, []);

	if (error) return <p class="portal-error">Couldn’t load your families: {error}</p>;
	if (!data) return <p class="portal-status">Loading your families…</p>;

	const f = data.family;
	return (
		<div class="dd-home mf">
			<section class="portal-card">
				<header class="dd-stuff-head">
					<h3>Your family</h3>
					<a href={families}>Directory</a>
				</header>
				{f ? (
					<div class="mf-owned">
						<div>
							<a class="mf-name" href={familyHref(f.slug)}>
								{f.name}
							</a>
							<p class="pf-help">
								<span class={`dd-status tone-${FAMILY_STATUS[f.status].tone}`}>{FAMILY_STATUS[f.status].label}</span>
								{f.joinRequests > 0 && ` · ${f.joinRequests} join request${f.joinRequests === 1 ? '' : 's'}`}
							</p>
						</div>
						<a class="pf-button primary" href={familyHref(f.slug)}>
							Manage family
						</a>
					</div>
				) : (
					<div class="mf-owned">
						<p class="pf-help">You don’t own a family. Each player can found one, and an admin reviews it.</p>
						<a class="pf-button primary" href={`${families}new/`}>
							Found a family
						</a>
					</div>
				)}
			</section>

			<section class="portal-card">
				<header class="dd-stuff-head">
					<h3>Your characters’ families</h3>
				</header>
				{data.memberships.length === 0 ? (
					<p class="pf-empty">
						None of your characters is in a family yet. Characters join by being made for a family: open one from the <a href={families}>directory</a> and start a
						character there.
					</p>
				) : (
					<ul class="dd-rows">
						{data.memberships.map((m) => (
							<li key={`${m.familySlug}-${m.characterId}`}>
								<span>
									<strong>{m.characterName}</strong> in <a href={familyHref(m.familySlug)}>{m.familyName}</a>
								</span>
								<span class={`dd-status tone-${m.status === 'active' ? 'good' : 'info'}`}>{m.status === 'active' ? 'Member' : 'Asked to join'}</span>
							</li>
						))}
					</ul>
				)}
			</section>

		</div>
	);
}
