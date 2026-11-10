// The character gallery: every approved character, searchable by name, player, power system,
// ability or family. Encrypted characters show only their name and player, behind a lock.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { loadUniverses, type Universe } from '../../lib/portal/api.ts';
import { loadGallery, type GalleryCharacter, type GalleryFamily } from '../../lib/portal/gallery.ts';
import { rules } from '../../lib/portal/rules.ts';
import { systemById } from '../../lib/portal/systems.ts';
import { portalConfigured } from '../../lib/supabase.ts';

const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
const href = (id: string) => `${base}character/?id=${encodeURIComponent(id)}`;
const PAGE = 48;
const potentialLabel = (id: string) => (id === 'ERROR' ? 'ERROR' : (rules.potentials.find((p) => p.id === id)?.label ?? ''));
const KINDS = [
	{ id: 'all', label: 'All' },
	{ id: 'oc', label: 'OCs' },
	{ id: 'canon', label: 'Canon' },
] as const;
type Kind = (typeof KINDS)[number]['id'];

function readUrl() {
	const q = new URLSearchParams(location.search);
	const kind = q.get('kind');
	return { search: q.get('q') ?? '', kind: (KINDS.some((k) => k.id === kind) ? kind : 'all') as Kind, system: q.get('system') ?? '', sort: q.get('sort') === 'name' ? 'name' : 'new' };
}

function Card({ c, families, universe }: { c: GalleryCharacter; families: GalleryFamily[]; universe: string }) {
	const fams = families.filter((f) => c.familyIds.includes(f.id));
	return (
		<a class={`gal-card${c.encrypted ? ' locked' : ''}`} href={href(c.id)} style={fams[0] ? { '--gal-fam': fams[0].colour } : undefined}>
			<span class="gal-art" aria-hidden="true">
				{c.encrypted ? <span class="gal-lock">🔒</span> : c.image ? <img src={c.image} alt="" loading="lazy" /> : <span class="gal-initial">{c.name.slice(0, 1)}</span>}
			</span>
			<span class="gal-body">
				<span class="gal-name">{c.name}</span>
				<span class="gal-player">
					{c.playerAvatar ? <img src={c.playerAvatar} alt="" width={18} height={18} loading="lazy" /> : null}
					{c.player}
				</span>
				<span class="gal-tags">
					{c.encrypted ? (
						<span class="gal-tag muted">Encrypted</span>
					) : (
						<>
							{c.kind === 'canon' && <span class="gal-tag canon">Canon{universe ? ` · ${universe}` : ''}</span>}
							{c.systems.slice(0, 3).map((s) => (
								<span class="gal-tag" key={s}>
									{systemById.get(s)?.label ?? s}
								</span>
							))}
							{c.systems.length > 3 && <span class="gal-tag muted">+{c.systems.length - 3}</span>}
							{potentialLabel(c.potential) && <span class="gal-tag pot">{potentialLabel(c.potential)}</span>}
						</>
					)}
				</span>
				{fams.length > 0 && <span class="gal-fam">{fams.map((f) => f.name).join(' · ')}</span>}
			</span>
		</a>
	);
}

export default function CharacterGallery() {
	const [data, setData] = useState<{ characters: GalleryCharacter[]; families: GalleryFamily[] } | null>(null);
	const [universes, setUniverses] = useState<Universe[]>([]);
	const [error, setError] = useState('');
	const initial = useMemo(readUrl, []);
	const [search, setSearch] = useState(initial.search);
	const [kind, setKind] = useState<Kind>(initial.kind);
	const [system, setSystem] = useState(initial.system);
	const [sort, setSort] = useState(initial.sort);
	const [shown, setShown] = useState(PAGE);

	useEffect(() => {
		if (!portalConfigured) {
			setError('The portal is not connected to its database.');
			return;
		}
		loadGallery().then(setData, (e) => setError(e instanceof Error ? e.message : String(e)));
		loadUniverses().then(setUniverses, () => {});
	}, []);

	// Keep the filters in the address, so a search can be shared or come back after a visit.
	useEffect(() => {
		const url = new URL(location.href);
		const set = (k: string, v: string, empty: string) => (v && v !== empty ? url.searchParams.set(k, v) : url.searchParams.delete(k));
		set('q', search.trim(), '');
		set('kind', kind, 'all');
		set('system', system, '');
		set('sort', sort, 'new');
		history.replaceState(null, '', url);
		setShown(PAGE);
	}, [search, kind, system, sort]);

	const universeName = (slug: string | null) => universes.find((u) => u.slug === slug)?.name ?? '';
	const famName = useMemo(() => new Map((data?.families ?? []).map((f) => [f.id, f.name])), [data]);

	const results = useMemo(() => {
		if (!data) return [];
		const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
		const list = data.characters.filter((c) => {
			if (kind !== 'all' && c.kind !== kind) return false;
			if (system && !c.systems.includes(system)) return false;
			if (!words.length) return true;
			const text = [
				c.name,
				c.player,
				universeName(c.universe),
				...c.systems.map((s) => systemById.get(s)?.label ?? s),
				...c.abilityNames,
				...c.familyIds.map((id) => famName.get(id) ?? ''),
			]
				.join(' ')
				.toLowerCase();
			return words.every((w) => text.includes(w));
		});
		return sort === 'name' ? [...list].sort((a, b) => a.name.localeCompare(b.name)) : list;
	}, [data, search, kind, system, sort, universes]);

	// Only the systems someone in the gallery uses.
	const systemOptions = useMemo(() => {
		const used = new Set((data?.characters ?? []).flatMap((c) => c.systems));
		return [...used].map((id) => ({ id, label: systemById.get(id)?.label ?? id })).sort((a, b) => a.label.localeCompare(b.label));
	}, [data]);

	const filtered = Boolean(search.trim() || kind !== 'all' || system);
	return (
		<div class="pf gal">
			<header class="gal-head">
				<p class="gal-intro">
					Every approved character in Singularity. Encrypted characters only show their name and player.
				</p>
				<div class="gal-tools">
					<div class="gal-search">
						<label class="sr-only" for="gal-search">
							Search characters
						</label>
						<input id="gal-search" type="search" value={search} placeholder="Search a name, player, power, ability or family" onInput={(e) => setSearch(e.currentTarget.value)} />
					</div>
					<div class="gal-kinds" role="group" aria-label="Kind">
						{KINDS.map((k) => (
							<button type="button" key={k.id} class={kind === k.id ? 'on' : undefined} aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
								{k.label}
							</button>
						))}
					</div>
					<select aria-label="Power system" value={system} onChange={(e) => setSystem(e.currentTarget.value)}>
						<option value="">Every power system</option>
						{systemOptions.map((s) => (
							<option key={s.id} value={s.id}>
								{s.label}
							</option>
						))}
					</select>
					<select aria-label="Sort" value={sort} onChange={(e) => setSort(e.currentTarget.value === 'name' ? 'name' : 'new')}>
						<option value="new">Newest first</option>
						<option value="name">A to Z</option>
					</select>
				</div>
			</header>

			{error && <p class="portal-error">{error}</p>}
			{!data && !error && <p class="portal-status">Loading characters…</p>}
			{data && (
				<>
					<p class="gal-count" role="status">
						{results.length} character{results.length === 1 ? '' : 's'}
						{filtered && (
							<button
								type="button"
								class="pf-link-button"
								onClick={() => {
									setSearch('');
									setKind('all');
									setSystem('');
								}}
							>
								Clear filters
							</button>
						)}
					</p>
					{results.length === 0 ? (
						<p class="pf-empty">{data.characters.length ? 'No character matches that.' : 'No approved characters yet.'}</p>
					) : (
						<div class="gal-grid">
							{results.slice(0, shown).map((c) => (
								<Card key={c.id} c={c} families={data.families} universe={universeName(c.universe)} />
							))}
						</div>
					)}
					{results.length > shown && (
						<button type="button" class="pf-button gal-more" onClick={() => setShown((n) => n + PAGE)}>
							Show more ({results.length - shown} left)
						</button>
					)}
				</>
			)}
		</div>
	);
}
