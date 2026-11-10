// One family's page (?f=slug): the public view, joining (?inherit=<character id> is the Inheritance), and the owner's editor.
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import {
	FOUND_IN,
	PERK_ACCESS,
	RECRUITING,
	STANDINGS,
	familiesBase,
	groupPerks,
	loadFamilies,
	loadFamily,
	loadMyApprovedCharacters,
	removeMember,
	richText,
	type FamilyBundle,
	type Member,
	type MyCharacter,
} from '../../lib/families/api.ts';
import { PerkBuilt, isBuilt } from './PerkBuilders.tsx';
import { portalConfigured, watchPlayer, logIn, type Player } from '../../lib/supabase.ts';
import FamilyEditor from './FamilyEditor.tsx';
import { InheritanceBuilder } from './InheritanceBuilder.tsx';
import { loadMyInheritanceDrafts, startInheritance, type InheritanceDraft } from '../../lib/families/inheritanceApi.ts';
import { FactTiles, LoginCard, StatusBanner, messageOf, useFamilyTheme } from './shared.tsx';

function Portrait({ m, portraits }: { m: Member; portraits: Record<string, string> }) {
	const src = (m.character_id && portraits[m.character_id]) || (/^https:\/\//.test(m.image_url) ? m.image_url : '');
	return <span class="fm-face">{src ? <img src={src} alt="" loading="lazy" /> : m.name.slice(0, 1)}</span>;
}

function MemberRow({ m, portraits }: { m: Member; portraits: Record<string, string> }) {
	return (
		<li class={`fm-member${m.title ? ' titled' : ''}`}>
			<Portrait m={m} portraits={portraits} />
			<span class="fm-member-text">
				<strong>{m.name}</strong>
				{(m.title || m.relationship) && <span class="fm-member-sub">{[m.title, m.relationship].filter(Boolean).join(' · ')}</span>}
			</span>
			{m.character_id && <span class="fm-tag" title="A portal character">OC</span>}
		</li>
	);
}

/** Long lists show their first few entries, with a button for the rest. */
const SHOWN = 5;
function Collapsible({ items, noun }: { items: JSX.Element[]; noun: string }) {
	const [all, setAll] = useState(false);
	const hidden = items.length - SHOWN;
	return (
		<>
			<ul class="fm-members">{all || hidden <= 1 ? items : items.slice(0, SHOWN)}</ul>
			{hidden > 1 && (
				<button type="button" class="fm-more" aria-expanded={all} onClick={() => setAll(!all)}>
					{all ? 'Show fewer' : `Show all ${items.length} ${noun}`}
				</button>
			)}
		</>
	);
}

function Prose({ text }: { text: string }) {
	return <div class="fm-prose" dangerouslySetInnerHTML={{ __html: richText(text) }} />;
}

function Block({ id, title, children, badge }: { id: string; title: string; children: ComponentChildren; badge?: ComponentChildren }) {
	return (
		<section class="pf-section fm-block" id={id} aria-labelledby={`${id}-title`}>
			<header class="pf-section-head">
				<h2 id={`${id}-title`}>{title}</h2>
				{badge}
			</header>
			{children}
		</section>
	);
}

const DRAFT_STATE = { draft: 'Being made', pending: 'With the owner', needs_correction: 'Needs changes', denied: 'Denied' } as const;
const inheritHref = (slug: string, id: string) => `${location.pathname}?f=${encodeURIComponent(slug)}&inherit=${encodeURIComponent(id)}`;

/** Joining: characters join only by being made for the family, starting with its Inheritance. */
function JoinPanel({ b, player, onChanged }: { b: FamilyBundle; player: Player | null; onChanged: () => void }) {
	const [chars, setChars] = useState<MyCharacter[] | null>(null);
	const [drafts, setDrafts] = useState<InheritanceDraft[] | null>(null);
	const [name, setName] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [done, setDone] = useState('');
	useEffect(() => {
		if (!player) return;
		loadMyApprovedCharacters().then(setChars, (e) => setError(messageOf(e)));
		loadMyInheritanceDrafts(b.family.id).then(setDrafts, () => setDrafts([]));
	}, [player?.id]);

	const open = b.family.recruiting === 'open';
	if (b.family.status !== 'approved') return null;
	const badge = <span class={`pf-badge${open ? ' ok' : ''}`}>{RECRUITING[b.family.recruiting]}</span>;
	const how = `Characters join ${b.family.name} by being made for it: you start with the family’s Inheritance, then build the rest of the sheet. Characters that already exist can’t join.`;
	if (!player)
		return (
			<Block id="join" title="Join" badge={badge}>
				<p class="pf-intro">{how}</p>
				{open && (
					<button type="button" class="portal-button discord" onClick={() => logIn().catch((e) => setError(messageOf(e)))}>
						Log in with Discord to start one
					</button>
				)}
				{error && <p class="portal-error">{error}</p>}
			</Block>
		);
	if (!chars || !drafts) return null;

	const mineHere = b.members.filter((m) => m.character_id && chars.some((c) => c.id === m.character_id));

	async function leave(id: string, label: string) {
		setBusy(true);
		setError('');
		try {
			await removeMember(id);
			setDone(label);
			onChanged();
		} catch (e) {
			setError(messageOf(e));
		} finally {
			setBusy(false);
		}
	}
	async function start() {
		setBusy(true);
		setError('');
		try {
			const id = await startInheritance(b.family.id, name);
			location.href = inheritHref(b.family.slug, id);
		} catch (e) {
			setError(messageOf(e));
			setBusy(false);
		}
	}

	return (
		<Block id="join" title="Join" badge={badge}>
			<p class="pf-intro">{how}</p>
			{mineHere.length > 0 && (
				<ul class="fm-mine">
					{mineHere.map((m) => (
						<li key={m.id}>
							<strong>{m.name}</strong> · {m.status === 'active' ? 'Member' : 'Request pending'}
							<button type="button" class="pf-button subtle" disabled={busy} onClick={() => leave(m.id, m.status === 'active' ? `${m.name} left the family.` : 'Request withdrawn.')}>
								{m.status === 'active' ? 'Leave' : 'Withdraw'}
							</button>
						</li>
					))}
				</ul>
			)}
			{mineHere.some((m) => m.status === 'active') && <p class="pf-help">Leaving removes your character from the roster, and they lose this family's perks.</p>}

			{drafts.length > 0 && (
				<>
					<h3 class="pf-subhead">Your characters for {b.family.name}</h3>
					<ul class="fm-mine">
						{drafts.map((d) => (
							<li key={d.id}>
								<span>
									<strong>{d.name || 'Unnamed'}</strong> · {DRAFT_STATE[d.status]}
								</span>
								<a class="pf-button subtle" href={inheritHref(b.family.slug, d.id)}>
									Inheritance
								</a>
								<a class="pf-button subtle" href={`${import.meta.env.BASE_URL.replace(/\/?$/, '/')}submit/?id=${encodeURIComponent(d.id)}`}>
									Sheet
								</a>
							</li>
						))}
					</ul>
				</>
			)}

			{open ? (
				<div class="fm-start">
					<div class="pf-field">
						<label class="pf-label" for="fm-start-name">
							New character’s name
						</label>
						<input id="fm-start-name" value={name} maxLength={100} placeholder="You can change it later" onInput={(e) => setName(e.currentTarget.value)} />
					</div>
					<button type="button" class="pf-button primary" disabled={!name.trim() || busy} onClick={start}>
						{busy ? 'Starting…' : 'Start a family character'}
					</button>
				</div>
			) : (
				<p class="pf-intro">{b.family.name} is closed to new members right now.</p>
			)}
			{done && <p class="fm-done">{done}</p>}
			{error && <p class="portal-error">{error}</p>}
		</Block>
	);
}

export function FamilyView({ b, player, onChanged }: { b: FamilyBundle; player: Player | null; onChanged: () => void }) {
	const f = b.family;
	const active = b.members.filter((m) => m.status === 'active');
	const banner = /^https:\/\//.test(f.banner_url) ? f.banner_url : null;
	const unassigned = active.filter((m) => !m.division_id || !b.divisions.some((d) => d.id === m.division_id));
	const relationsBy = STANDINGS.map((s) => ({ ...s, rows: b.relations.filter((r) => r.standing === s.id), note: b.notes.find((n) => n.standing === s.id)?.note }));
	const openPerks = b.perks.filter((p) => p.unlocked);
	const lockedPerks = b.perks.length - openPerks.length;
	const perkGroups = groupPerks(openPerks, b.family.perk_sections);

	return (
		<>
			<header class={`fm-hero${banner ? ' has-banner' : ''}`}>
				{banner && <img class="fm-hero-img" src={banner} alt="" />}
				<div class="fm-hero-text">
					<p class="fm-chips">
						{f.special_statuses.map((s) => (
							<span class="fm-chip special" key={s}>
								{s}
							</span>
						))}
						<span class={`fm-chip ${f.recruiting === 'closed' ? 'muted' : 'good'}`}>{RECRUITING[f.recruiting]}</span>
						{f.sealed && (
							<span class="fm-chip lock" title="Members' sheets and the perks are for the family only">
								🔒 Sealed
							</span>
						)}
					</p>
					<h1 class="fm-title">{f.name}</h1>
					{f.description && <p class="fm-lead">{f.description}</p>}
				</div>
			</header>

			<FactTiles
				items={[
					{ label: 'Head of Family', value: f.head_name },
					{ label: 'Run by', value: b.owner?.display_name },
					{ label: 'Race', value: f.race },
					{ label: 'Specialty', value: f.specialty },
					{ label: 'Found in', value: FOUND_IN[f.found_in] },
					{ label: 'Members', value: active.length },
				]}
			/>

			{f.lore && (
				<Block id="lore" title="Lore">
					<Prose text={f.lore} />
				</Block>
			)}

			{(b.divisions.length > 0 || unassigned.length > 0) && (
				<Block id="roster" title={b.divisions.length ? 'Divisions' : 'Members'}>
					<div class="fm-divisions">
						{b.divisions.map((d) => {
							const people = active.filter((m) => m.division_id === d.id);
							const open = (key: string, sub: string) => (
								<li class="fm-member open" key={key}>
									<span class="fm-face">?</span>
									<span class="fm-member-text">
										<strong>Open spot</strong>
										<span class="fm-member-sub">{sub}</span>
									</span>
								</li>
							);
							const spots = d.open_spots + (d.head_open ? 1 : 0);
							return (
								<article class="fm-division" key={d.id}>
									<h3>{d.name}</h3>
									<p class="fm-division-count">
										{people.length} member{people.length === 1 ? '' : 's'}
										{spots > 0 && ` · ${spots} open spot${spots === 1 ? '' : 's'}`}
									</p>
									{d.description && <p class="fm-division-text">{d.description}</p>}
									<Collapsible
										noun="members"
										items={[
											...(d.head_open ? [open('head', `Head · ${RECRUITING[f.recruiting]}`)] : []),
											...people.map((m) => <MemberRow key={m.id} m={m} portraits={b.portraits} />),
											...Array.from({ length: d.open_spots }, (_, i) => open(`open-${i}`, RECRUITING[f.recruiting])),
										]}
									/>
								</article>
							);
						})}
						{unassigned.length > 0 && (
							<article class="fm-division">
								<h3>{b.divisions.length ? 'Other members' : 'Roster'}</h3>
								<Collapsible noun="members" items={unassigned.map((m) => <MemberRow key={m.id} m={m} portraits={b.portraits} />)} />
							</article>
						)}
					</div>
				</Block>
			)}

			{f.home && (
				<Block id="home" title="Home">
					<Prose text={f.home} />
				</Block>
			)}

			{b.relations.length > 0 && (
				<Block id="relations" title="Relations">
					<div class="fm-relations">
						{relationsBy
							.filter((s) => s.rows.length)
							.map((s) => (
								<div class={`fm-standing tone-${s.tone}`} key={s.id}>
									<p class="fm-standing-label">{s.label}</p>
									<ul>
										{s.rows.map((r) => (
											<li key={r.id}>
												{r.other_family_id ? <strong>{r.other_name}</strong> : r.other_name}
												{r.note && <span class="fm-member-sub"> · {r.note}</span>}
											</li>
										))}
									</ul>
									{s.note && <p class="fm-standing-note">{s.note}</p>}
								</div>
							))}
					</div>
				</Block>
			)}

			<Block id="perks" title="Perks" badge={b.perks.length ? <span class="mc-count">{b.perks.length}</span> : undefined}>
				{b.perks.length === 0 && <p class="pf-empty">No perks yet.</p>}
				{perkGroups.map((g) => (
					<div class="fm-perk-group" key={g.id}>
						<h3 class="fm-perk-kind">{g.label}</h3>
						{g.rows.map((p) => (
							<details class="fm-perk" key={p.id}>
								<summary>
									<strong>{p.title}</strong>
									<span class="fm-perk-tags">
										{p.hidden && <span class="fm-chip lock">Members only</span>}
										<span class="fm-chip">{PERK_ACCESS.find((x) => x.id === p.access)?.label.replace(/:.*/, '')}</span>
									</span>
								</summary>
								{p.kind !== 'locked_power' && p.description && <Prose text={p.description} />}
								<PerkBuilt kind={p.kind} details={p.details} />
								{p.kind === 'locked_power' && p.description && <Prose text={p.description} />}
								{!p.description && !isBuilt(p.kind ?? 'other') && <p class="pf-empty">No details.</p>}
							</details>
						))}
					</div>
				))}
				{lockedPerks > 0 && (
					<div class="fm-perk-locked">
						<span class="fm-lock" aria-hidden="true">
							🔒
						</span>
						<div>
							<strong>
								{f.sealed && lockedPerks === b.perks.length ? `${f.name} is sealed` : `${lockedPerks} members-only perk${lockedPerks === 1 ? '' : 's'}`}
							</strong>
							<p>
								{f.sealed
									? `Its perks and its members’ sheets are for the family only. Start a character in its Inheritance and ask the owner to let you in.`
									: `Only this family's members can see ${lockedPerks === 1 ? 'it' : 'them'}. Start a character in its Inheritance and ask the owner to let you in.`}
							</p>
						</div>
					</div>
				)}
			</Block>

			<JoinPanel b={b} player={player} onChanged={onChanged} />
		</>
	);
}

export default function FamilyPage() {
	const slug = useMemo(() => new URLSearchParams(location.search).get('f') ?? '', []);
	const inherit = useMemo(() => new URLSearchParams(location.search).get('inherit') ?? '', []);
	const [player, setPlayer] = useState<Player | null | undefined>(undefined);
	const [bundle, setBundle] = useState<FamilyBundle | null>(null);
	const [editing, setEditing] = useState(() => location.hash === '#edit');
	const [families, setFamilies] = useState<{ id: string; name: string }[]>([]);
	const [error, setError] = useState('');

	useFamilyTheme(bundle?.family.colour);
	useEffect(() => {
		if (!portalConfigured) return setError('The portal is not connected to its database yet.');
		if (!slug) return setError('No family chosen.');
		watchPlayer((p) => setPlayer(p));
		const onHash = () => setEditing(location.hash === '#edit');
		addEventListener('hashchange', onHash);
		return () => removeEventListener('hashchange', onHash);
	}, []);

	const canManage = (owner: string | null) => Boolean(player && (player.isAdmin || owner === player.id));
	async function load() {
		try {
			setBundle(await loadFamily(slug, (f) => canManage(f.owner_id)));
		} catch (e) {
			setError(messageOf(e));
		}
	}
	useEffect(() => {
		if (player !== undefined) load();
	}, [player?.id ?? null, player === undefined]);
	useEffect(() => {
		if (bundle) document.title = `${bundle.family.name} | Divine Database`;
	}, [bundle?.family.name]);
	// Other families' names, for the relations editor.
	useEffect(() => {
		if (editing && families.length === 0) loadFamilies().then(setFamilies, () => {});
	}, [editing]);

	if (error)
		return (
			<div class="pf fm">
				<p class="portal-error">{error}</p>
				<a class="pf-button" href={familiesBase}>
					← Family Directory
				</a>
			</div>
		);
	if (!bundle) return <p class="portal-status">Loading family…</p>;

	const manage = canManage(bundle.family.owner_id);
	const requests = bundle.members.filter((m) => m.status === 'requested').length;
	const pendingPerks = bundle.allPerks.filter((p) => p.status === 'pending').length;

	return (
		<div class="pf fm fm-page">
			<div class="fm-toolbar">
				{inherit ? (
					<a class="pf-button subtle" href={`${location.pathname}?f=${encodeURIComponent(slug)}`}>
						← {bundle.family.name}
					</a>
				) : (
					<a class="pf-button subtle" href={familiesBase}>
						← Directory
					</a>
				)}
				{manage && !inherit && (
					<button
						type="button"
						class={`pf-button${editing ? '' : ' primary'}`}
						onClick={() => {
							setEditing(!editing);
							history.replaceState(null, '', editing ? location.pathname + location.search : '#edit');
							scrollTo({ top: 0 });
						}}
					>
						{editing ? 'Done editing' : `Manage family${requests ? ` · ${requests} request${requests === 1 ? '' : 's'}` : ''}`}
					</button>
				)}
			</div>
			{manage && <StatusBanner status={bundle.family.status} note={bundle.family.review_note} />}
			{manage && !editing && pendingPerks > 0 && <p class="pf-help">{pendingPerks} perk{pendingPerks === 1 ? '' : 's'} waiting for an admin.</p>}
			{inherit && !editing ? (
				player ? (
					<InheritanceBuilder b={bundle} characterId={inherit} />
				) : (
					<LoginCard text="Log in with Discord to work on your character’s Inheritance." onError={setError} />
				)
			) : editing && manage ? (
				<FamilyEditor b={bundle} families={families} isAdmin={Boolean(player?.isAdmin)} onSaved={load} />
			) : (
				<FamilyView b={bundle} player={player ?? null} onChanged={load} />
			)}
		</div>
	);
}
