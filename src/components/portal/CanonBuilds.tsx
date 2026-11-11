// Canon power builds: the admin panel to design a canon ability's skills (and each Quirk Variant's),
// and the read-only list a card holding the claim shows.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { deleteCanonBuild, loadCanonBuilds, loadClaimBoard, saveCanonBuild, type ClaimRow, type Universe } from '../../lib/portal/api.ts';
import { blankVariant, canonGroups, cleanBuild, variantsFor, type CanonBuild, type VariantBuild } from '../../lib/portal/canonBuilds.ts';
import type { Fields } from '../../lib/portal/systems.ts';
import { systems } from '../../lib/portal/systems.ts';
import { ScalingTags } from './SkillScaling.tsx';
import { SkillsEditor } from './SystemsSection.tsx';
import { TextArea } from './fields.tsx';

const messageOf = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));

// Every build, loaded once per page and shared by every card.
let cache: Promise<Map<string, CanonBuild>> | null = null;
const listeners = new Set<() => void>();
function fetchBuilds(fresh = false) {
	if (!cache || fresh) {
		cache = loadCanonBuilds().then(
			(rows) => new Map(rows.map((r) => [r.claimable_id, r])),
			() => new Map(),
		);
		if (fresh) cache.then(() => listeners.forEach((l) => l()));
	}
	return cache;
}

export function useCanonBuilds() {
	const [builds, setBuilds] = useState<Map<string, CanonBuild> | null>(null);
	useEffect(() => {
		let live = true;
		const get = () => fetchBuilds().then((m) => live && setBuilds(m));
		get();
		listeners.add(get);
		return () => {
			live = false;
			listeners.delete(get);
		};
	}, []);
	return builds;
}

/** The series' main card system, for a claim's labels and limits. */
const systemOfUniverse = (universe: string) => systems.find((s) => s.universe === universe && s.id !== 'abilities')?.id;

/** On a card holding the claim: the canon skills, then each variant's (reached ones open). */
export function CanonSkills(props: { claim: ClaimRow | undefined; system: string; fields: Fields; compact?: boolean }) {
	const builds = useCanonBuilds();
	const build = props.claim ? builds?.get(props.claim.id) : undefined;
	const groups = canonGroups(build, props.system, props.fields);
	if (!groups.length) return null;
	const list = (skills: CanonBuild['skills']) =>
		props.compact ? (
			<ul class="wk-skills">
				{skills.map((sk, i) => (
					<li key={i} class={sk.type}>
						<strong>{sk.name || 'Unnamed'}</strong> <span class="trait-meta">{sk.type} · canon</span>
						<ScalingTags skill={sk} system={props.system} />
						{sk.effect && <p>{sk.effect}</p>}
					</li>
				))}
			</ul>
		) : (
			<div class="df-techniques-list">
				{skills.map((sk, i) => (
					<div class={`df-technique-card ${sk.type} df-technique-default`} key={i}>
						<div class="df-technique-card-header">
							<div class="df-technique-identity">
								<span class="df-technique-icon">{sk.type === 'ultimate' ? '💥' : sk.type === 'passive' ? '🛡️' : '⚔️'}</span>
								<span class="df-technique-name">{sk.name || <em>Unnamed</em>}</span>
								<span class={`df-tag ${sk.type === 'passive' ? 'passive' : sk.type === 'ultimate' ? 'priority' : 'standard'}`}>{sk.type === 'ultimate' ? 'Ultimate' : sk.type === 'passive' ? 'Passive' : 'Standard'}</span>
								<span class="df-tag df-tag-locked">Canon</span>
							</div>
						</div>
						<ScalingTags skill={sk} system={props.system} />
						{sk.effect && <p class="df-technique-effect">{sk.effect}</p>}
					</div>
				))}
			</div>
		);
	return (
		<div class={`pf-wide cbx-skills${props.compact ? ' compact' : ''}`}>
			{groups.map((g) =>
				g.reached ? (
					<div class="cbx-group" key={g.variant || 'base'}>
						<p class={props.compact ? 'wk-sub-label' : 'cbx-group-title'}>
							{g.variant ? `${g.label} skills` : `${props.claim!.name}: canon skills`}
							{!props.compact && <span class="pf-help">{g.variant ? 'From the variant' : 'Every holder has these'}, on top of your own skills.</span>}
						</p>
						{g.about.trim() && <p class="pf-help cbx-about">{g.about}</p>}
						{list(g.skills)}
					</div>
				) : (
					<details class="cbx-group cbx-locked" key={g.variant}>
						<summary>
							🔒 {g.label}: {g.skills.length} more skill{g.skills.length === 1 ? '' : 's'} once the Quirk reaches it
						</summary>
						{g.about.trim() && <p class="pf-help cbx-about">{g.about}</p>}
						{list(g.skills)}
					</details>
				),
			)}
		</div>
	);
}

/** Admin panel: every canon ability on the claim board, and the builder for one. */
export function CanonBuildsPanel(props: { universes: Universe[] }) {
	const [board, setBoard] = useState<ClaimRow[] | null>(null);
	const builds = useCanonBuilds();
	const [error, setError] = useState('');
	const [open, setOpen] = useState<ClaimRow | null>(null);
	const [query, setQuery] = useState('');
	useEffect(() => {
		loadClaimBoard().then(
			(rows) => setBoard(rows.filter((r) => r.claim_type === 'ability')),
			(e) => setError(messageOf(e)),
		);
	}, []);
	const universeName = (slug: string) => props.universes.find((u) => u.slug === slug)?.name ?? slug;
	const groups = useMemo(() => {
		const q = query.trim().toLowerCase();
		const rows = (board ?? []).filter((r) => !q || r.name.toLowerCase().includes(q) || universeName(r.universe).toLowerCase().includes(q));
		const by = new Map<string, ClaimRow[]>();
		for (const r of rows) by.set(r.universe, [...(by.get(r.universe) ?? []), r]);
		return [...by.entries()];
	}, [board, query, props.universes]);

	if (error) return <p class="portal-error">{error}</p>;
	if (!board || !builds) return <p class="portal-status">Loading canon powers…</p>;
	if (open) return <CanonEditor claim={open} universe={universeName(open.universe)} build={builds.get(open.id) ?? null} onClose={() => setOpen(null)} />;

	return (
		<div class="pw">
			<div class="pw-head">
				<p class="pf-intro">Design a canon power’s skills (and a Quirk’s Variant skills). Everyone holding it gets them on their card, on top of their own, and sees your changes straight away.</p>
			</div>
			<input class="cbx-search" type="search" aria-label="Search canon powers" placeholder="Search, e.g. Engine" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
			{groups.map(([universe, rows]) => (
				<section class="cbx-universe" key={universe}>
					<h3 class="cbx-universe-title">
						{universeName(universe)} <span class="pf-help">{rows.filter((r) => builds.has(r.id)).length} of {rows.length} built</span>
					</h3>
					<ul class="cbx-list">
						{rows.map((r) => {
							const b = builds.get(r.id);
							const variants = b ? Object.keys(b.variants ?? {}) : [];
							return (
								<li key={r.id}>
									<button type="button" class={`cbx-item${b ? ' built' : ''}`} onClick={() => setOpen(r)}>
										<strong>{r.name}</strong>
										<span class="cbx-item-meta">
											{b ? `${b.skills.length} skill${b.skills.length === 1 ? '' : 's'}${variants.length ? ` · ${variants.join(', ')}` : ''}` : 'Not built'}
										</span>
									</button>
								</li>
							);
						})}
					</ul>
				</section>
			))}
			{!groups.length && <p class="pf-empty">No canon powers match.</p>}
		</div>
	);
}

function CanonEditor(props: { claim: ClaimRow; universe: string; build: CanonBuild | null; onClose: () => void }) {
	const system = systemOfUniverse(props.claim.universe);
	const def = systems.find((s) => s.id === system);
	const variantNames = variantsFor(system);
	const initial = { about: props.build?.about ?? '', skills: props.build?.skills ?? [], variants: props.build?.variants ?? {} };
	const [d, setD] = useState(structuredClone(initial));
	const [tab, setTab] = useState('');
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState('');
	const [confirmDelete, setConfirmDelete] = useState(false);
	const dirty = JSON.stringify(d) !== JSON.stringify(initial);
	let limits;
	try {
		limits = def?.startingMoves?.({});
	} catch {
		limits = undefined;
	}
	const variant: VariantBuild = tab ? d.variants[tab] ?? blankVariant() : { about: d.about, skills: d.skills };
	const setVariant = (patch: Partial<VariantBuild>) =>
		setD((x) => (tab ? { ...x, variants: { ...x.variants, [tab]: { ...(x.variants[tab] ?? blankVariant()), ...patch } } } : { ...x, ...patch }));

	async function run(fn: () => Promise<void>, done: string) {
		setBusy(true);
		setMsg('');
		try {
			await fn();
			await fetchBuilds(true);
			setMsg(done);
		} catch (e) {
			setMsg(messageOf(e));
		} finally {
			setBusy(false);
		}
	}

	return (
		<div class="pw pf">
			<div class="pw-head">
				<button type="button" class="df-back-btn" onClick={props.onClose}>
					← All canon powers
				</button>
				<h3 class="pw-title">{props.claim.name}</h3>
				<span class="pf-help">{props.universe}</span>
			</div>

			{variantNames.length > 0 && (
				<div class="cbx-tabs" role="tablist" aria-label="Base or variant">
					{['', ...variantNames].map((v) => {
						const n = v ? d.variants[v]?.skills.length ?? 0 : d.skills.length;
						return (
							<button key={v || 'base'} type="button" role="tab" aria-selected={tab === v} class={`cbx-tab${tab === v ? ' active' : ''}`} onClick={() => setTab(v)}>
								{v ? `${v} Variant` : 'Base'}
								<span class="df-tab-badge">{n}</span>
							</button>
						);
					})}
				</div>
			)}

			<fieldset class="sys-group pf-wide">
				<legend>{tab ? `${tab} Variant` : 'Canon skills'}</legend>
				<p class="pf-help">
					{tab
						? `Extra skills a holder gets once their Quirk reaches the ${tab} Variant (and every variant after it). The skills before it stay.`
						: 'Every holder gets these on the card, on top of the skills they write themselves. They don’t count toward their starting skills.'}
				</p>
				<div class="pf-grid">
					<TextArea label={tab ? 'What the variant adds' : 'Notes on the build'} rows={3} value={variant.about} placeholder="Optional. Shown above the skills." onInput={(about) => setVariant({ about })} />
					<SkillsEditor
						key={tab}
						skills={variant.skills}
						disabled={false}
						limits={limits}
						isEvolution={false}
						noLimits
						scalingSystem={system}
						editScaling
						onUpdate={(fn) => setVariant({ skills: fn(variant.skills) })}
					/>
				</div>
			</fieldset>

			<div class="pw-actions">
				<button type="button" class="pf-button primary" disabled={busy || !dirty} onClick={() => run(() => saveCanonBuild(props.claim.id, cleanBuild(d, system)), 'Saved. Holders see it now.')}>
					Save build
				</button>
				{props.build &&
					(confirmDelete ? (
						<>
							<span class="pf-help">Delete the whole build? Holders lose these skills from their cards.</span>
							<button type="button" class="pf-button danger" disabled={busy} onClick={() => run(() => deleteCanonBuild(props.claim.id).then(props.onClose), '')}>
								Yes, delete
							</button>
							<button type="button" class="pf-button subtle" onClick={() => setConfirmDelete(false)}>
								Keep it
							</button>
						</>
					) : (
						<button type="button" class="pf-button subtle" onClick={() => setConfirmDelete(true)}>
							Delete build
						</button>
					))}
				{msg && (
					<span class="pf-help" role="status">
						{msg}
					</span>
				)}
			</div>
			{dirty && <p class="pf-help">Unsaved changes.</p>}
		</div>
	);
}
