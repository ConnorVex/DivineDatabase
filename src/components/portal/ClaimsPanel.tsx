// Admin Panel → Claims: every canon claim on the claim board, per universe. Admins can add one,
// rename it, move it to another category, change how many spots it has or how many holders are
// tracked by hand, and free or un-count a character holding it. Saving updates the claim board, so
// the submit form and the Index's canon pages pick it up straight away.
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
	adminDeleteClaimable,
	adminRemoveHolder,
	adminSaveClaimable,
	adminSetHolderCounts,
	loadClaimAdmin,
	type Claimable,
	type ClaimHolder,
	type ClaimRow,
	type Universe,
} from '../../lib/portal/api.ts';
import { NumberField, SelectField, TextArea, TextField } from './fields.tsx';

const messageOf = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));

const TYPES: { id: ClaimRow['claim_type']; label: string }[] = [
	{ id: 'ability', label: 'Abilities' },
	{ id: 'character', label: 'Characters' },
	{ id: 'ocular', label: 'Oculars' },
];

type Draft = Omit<Claimable, 'id'> & { id?: string };

/** Spots taken: hand-tracked holders plus the characters that count toward the limit. */
export const usedOf = (c: Claimable, holders: ClaimHolder[]) => c.manual_users + holders.filter((h) => h.claimable_id === c.id && h.counts_toward_limit).length;

export function ClaimsPanel(props: { universes: Universe[]; onChanged?: () => void }) {
	const [data, setData] = useState<{ claimables: Claimable[]; holders: ClaimHolder[] } | null>(null);
	const [universe, setUniverse] = useState(() => new URLSearchParams(location.search).get('universe') ?? '');
	const [type, setType] = useState<ClaimRow['claim_type']>('ability');
	const [search, setSearch] = useState('');
	const [draft, setDraft] = useState<Draft | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	const reload = () => loadClaimAdmin().then(setData, (e) => setError(messageOf(e)));
	useEffect(() => void reload(), []);

	const universes = props.universes;
	const current = universe || universes[0]?.slug || '';
	const inUniverse = useMemo(() => (data?.claimables ?? []).filter((c) => c.universe === current), [data, current]);
	const types = TYPES.filter((t) => t.id !== 'ocular' || inUniverse.some((c) => c.claim_type === 'ocular'));
	const shown = inUniverse.filter((c) => c.claim_type === type && (!search.trim() || `${c.name} ${c.category} ${c.note}`.toLowerCase().includes(search.trim().toLowerCase())));
	const categories = [...new Set(inUniverse.filter((c) => c.claim_type === type).map((c) => c.category))];
	const groups = categories.map((cat) => ({ cat, rows: shown.filter((c) => c.category === cat) })).filter((g) => g.rows.length);

	function pickUniverse(slug: string) {
		setUniverse(slug);
		setDraft(null);
		const url = new URL(location.href);
		url.searchParams.set('universe', slug);
		history.replaceState(null, '', url);
	}

	async function run(work: () => Promise<unknown>) {
		setBusy(true);
		setError('');
		try {
			await work();
			await reload();
			props.onChanged?.();
			return true;
		} catch (e) {
			setError(messageOf(e));
			return false;
		} finally {
			setBusy(false);
		}
	}

	async function save() {
		if (!draft) return;
		if (!draft.name.trim()) return setError('Give the claim a name.');
		if (await run(() => adminSaveClaimable(draft))) setDraft(null);
	}

	async function remove() {
		if (!draft?.id) return;
		const held = data?.holders.filter((h) => h.claimable_id === draft.id).length ?? 0;
		const warn = held ? ` ${held} character${held === 1 ? ' holds' : 's hold'} it; they keep it on their sheet, but it leaves the claim board.` : '';
		if (!confirm(`Delete “${draft.name}” from the claim board?${warn} This can’t be undone.`)) return;
		if (await run(() => adminDeleteClaimable(draft.id!))) setDraft(null);
	}

	if (!data) return error ? <p class="portal-error">{error}</p> : <p class="portal-status">Loading claims…</p>;

	const newDraft = (): Draft => ({
		universe: current,
		claim_type: type,
		category: categories[0] ?? '',
		name: '',
		max_users: 1,
		manual_users: 0,
		note: '',
		sort_order: Math.max(0, ...inUniverse.filter((c) => c.claim_type === type).map((c) => c.sort_order)) + 1,
	});
	const holdersOf = (id?: string) => (id ? data.holders.filter((h) => h.claimable_id === id) : []);
	const editing = draft && (draft.id ? data.claimables.find((c) => c.id === draft.id) : undefined);

	return (
		<section class="hud-panel clm">
			<div class="clm-head">
				<h3 class="hud-panel-title">Claims</h3>
				<p class="pf-help">The claim board behind the submit form and the canon pages. Characters fill spots when they’re approved.</p>
			</div>

			<div class="clm-filters">
				<SelectField label="Universe" value={current} options={universes.map((u) => ({ value: u.slug, label: u.name }))} onChange={pickUniverse} />
				<TextField label="Search" type="search" value={search} placeholder="Name, category or note" onInput={setSearch} />
			</div>
			<div class="clm-types" role="tablist" aria-label="Claim type">
				{types.map((t) => (
					<button
						key={t.id}
						type="button"
						role="tab"
						aria-selected={type === t.id}
						class={type === t.id ? 'on' : undefined}
						onClick={() => {
							setType(t.id);
							setDraft(null);
						}}
					>
						{t.label}
						<span>{inUniverse.filter((c) => c.claim_type === t.id).length}</span>
					</button>
				))}
			</div>

			{error && <p class="portal-error">{error}</p>}

			{draft && !draft.id && <ClaimEditor draft={draft} categories={categories} holders={[]} busy={busy} onChange={setDraft} onSave={save} onCancel={() => setDraft(null)} />}
			{!draft && (
				<button type="button" class="bt-add clm-add" onClick={() => setDraft(newDraft())}>
					<span class="df-add-icon">＋</span>
					<span>Add a claim</span>
				</button>
			)}

			{groups.length === 0 && <p class="pf-empty">{search ? 'Nothing matches.' : 'No claims here yet.'}</p>}
			{groups.map((g) => (
				<div key={g.cat} class="clm-group">
					<h4 class="pf-subhead">{g.cat || 'No category'}</h4>
					<ul class="clm-list">
						{g.rows.map((c) => {
							const used = usedOf(c, data.holders);
							const full = c.max_users !== null && used >= c.max_users;
							const open = draft?.id === c.id;
							const names = holdersOf(c.id).map((h) => h.holder_name).filter(Boolean);
							return (
								<li key={c.id} class={`clm-row${open ? ' on' : ''}`}>
									<button type="button" class="clm-row-open" aria-expanded={open} onClick={() => setDraft(open ? null : { ...c })}>
										<span class="clm-name">{c.name}</span>
										<span class={`clm-used${full ? ' full' : ''}`}>
											{used} / {c.max_users ?? '∞'}
										</span>
										{(names.length > 0 || c.note) && <span class="clm-who">{names.length ? names.join(', ') : c.note}</span>}
									</button>
									{open && editing && (
										<ClaimEditor
											draft={draft!}
											categories={categories}
											holders={holdersOf(c.id)}
											busy={busy}
											onChange={setDraft}
											onSave={save}
											onCancel={() => setDraft(null)}
											onDelete={remove}
											onCount={(h, counts) => run(() => adminSetHolderCounts(h.id, counts))}
											onFree={(h) => confirm(`Free ${h.holder_name || 'this holder'}’s spot? Their sheet isn’t changed.`) && run(() => adminRemoveHolder(h.id))}
										/>
									)}
								</li>
							);
						})}
					</ul>
				</div>
			))}
		</section>
	);
}

function ClaimEditor(props: {
	draft: Draft;
	categories: string[];
	holders: ClaimHolder[];
	busy: boolean;
	onChange: (d: Draft) => void;
	onSave: () => void;
	onCancel: () => void;
	onDelete?: () => void;
	onCount?: (h: ClaimHolder, counts: boolean) => void;
	onFree?: (h: ClaimHolder) => void;
}) {
	const { draft, busy } = props;
	const set = (patch: Partial<Draft>) => props.onChange({ ...draft, ...patch });
	const listId = `clm-cats-${draft.id ?? 'new'}`;
	const unlimited = draft.max_users === null;
	return (
		<div class="clm-edit">
			<div class="clm-edit-grid">
				<TextField label="Name" required value={draft.name} onInput={(name) => set({ name })} />
				<TextField label="Category" list={listId} value={draft.category} placeholder="e.g. Standard" help="Pick one or type a new one." onInput={(category) => set({ category })} />
				<datalist id={listId}>
					{props.categories.map((c) => (
						<option key={c} value={c} />
					))}
				</datalist>
				<div class="clm-spots">
					<NumberField label="Spots" min={0} value={unlimited ? undefined : draft.max_users!} disabled={unlimited} onInput={(n) => set({ max_users: Math.max(0, Math.floor(n)) })} />
					<label class="clm-check">
						<input type="checkbox" checked={unlimited} onChange={(e) => set({ max_users: e.currentTarget.checked ? null : 1 })} />
						No limit
					</label>
				</div>
				<NumberField label="Taken by hand" min={0} value={draft.manual_users} help="Holders from before the Divine Database." onInput={(n) => set({ manual_users: Math.max(0, Math.floor(n)) })} />
				<NumberField label="Order" value={draft.sort_order} help="Lower shows first." onInput={(sort_order) => set({ sort_order })} />
			</div>
			<TextArea label="Note" rows={2} value={draft.note} placeholder="Optional, e.g. who holds it" onInput={(note) => set({ note })} />

			{props.holders.length > 0 && (
				<div class="clm-holders">
					<h5 class="sp-pot-head">Approved holders</h5>
					<ul>
						{props.holders.map((h) => (
							<li key={h.id}>
								<span class="clm-holder-name">{h.holder_name || 'Unnamed character'}</span>
								<label class="clm-check">
									<input type="checkbox" checked={h.counts_toward_limit} disabled={busy} onChange={(e) => props.onCount?.(h, e.currentTarget.checked)} />
									Takes a spot
								</label>
								<button type="button" class="pf-button subtle" disabled={busy} onClick={() => props.onFree?.(h)}>
									Free
								</button>
							</li>
						))}
					</ul>
				</div>
			)}

			<div class="clm-actions">
				{props.onDelete && (
					<button type="button" class="pf-button danger clm-delete" disabled={busy} onClick={props.onDelete}>
						Delete
					</button>
				)}
				<button type="button" class="pf-button subtle" disabled={busy} onClick={props.onCancel}>
					Cancel
				</button>
				<button type="button" class="pf-button primary" disabled={busy} onClick={props.onSave}>
					{busy ? 'Saving…' : draft.id ? 'Save' : 'Add claim'}
				</button>
			</div>
		</div>
	);
}
