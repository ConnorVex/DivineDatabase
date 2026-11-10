// The owner's editor for their family: page details, divisions, roster, relations and perks.
// Admins get the same editor for any family.
import { useMemo, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import {
	EDITABLE,
	PERK_ACCESS,
	PERK_KINDS,
	STANDINGS,
	acceptMember,
	removeMember,
	richText,
	saveDivisions,
	sendPerks,
	arrangePerks,
	saveRelations,
	saveRoster,
	saveStandingNotes,
	updateFamily,
	type DivisionDraft,
	type FamilyBundle,
	type FamilyFields,
	type MemberDraft,
	type Perk,
	type PerkDraft,
	type PerkAccess,
	type PerkKind,
	type RelationDraft,
	type Standing,
} from '../../lib/families/api.ts';
import { abilitySystem, systemById } from '../../lib/portal/systems.ts';
import { AbilityBuilder, StatsBuilder, TraitPicker, blankDetails, detailProblems, isBuilt } from './PerkBuilders.tsx';
import { ItemsBuilder, StyleBuilder, SystemRulesBuilder, TrackerBuilder, TraitRulesBuilder } from './PerkRules.tsx';
import { FamilyForm, familyProblems } from './FamilyForm.tsx';
import { messageOf } from './shared.tsx';
import { InheritanceTab } from './InheritanceRolls.tsx';

const TABS = [
	{ id: 'page', label: 'Page' },
	{ id: 'divisions', label: 'Divisions' },
	{ id: 'roster', label: 'Roster' },
	{ id: 'inheritance', label: 'Inheritance' },
	{ id: 'relations', label: 'Relations' },
	{ id: 'perks', label: 'Perks' },
] as const;
type Tab = (typeof TABS)[number]['id'];

/** Save bar shared by every tab. */
function SaveBar({
	dirty,
	problems,
	onSave,
	extra,
	label = 'Save',
	status,
}: {
	dirty: boolean;
	problems?: string[];
	onSave: () => Promise<void>;
	extra?: ComponentChildren;
	label?: string;
	/** Replaces "Unsaved changes". */
	status?: string;
}) {
	const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
	const [error, setError] = useState('');
	const blocked = Boolean(problems?.length);
	return (
		<div class="pf-actions">
			<span class={`pf-save-state ${state === 'saved' && !dirty ? 'saved' : state === 'error' ? 'error' : ''}`}>
				{state === 'saving' ? 'Saving…' : state === 'error' ? error : blocked ? problems![0] : dirty ? status || 'Unsaved changes' : state === 'saved' ? 'Saved' : 'No changes'}
			</span>
			{extra}
			<button
				type="button"
				class="pf-button primary"
				disabled={!dirty || blocked || state === 'saving'}
				onClick={async () => {
					setState('saving');
					try {
						await onSave();
						setState('saved');
					} catch (e) {
						setError(messageOf(e));
						setState('error');
					}
				}}
			>
				{label}
			</button>
		</div>
	);
}

function Move({ i, n, onMove }: { i: number; n: number; onMove: (from: number, to: number) => void }) {
	return (
		<span class="fm-move">
			<button type="button" class="pf-button subtle" disabled={i === 0} onClick={() => onMove(i, i - 1)} aria-label="Move up">
				↑
			</button>
			<button type="button" class="pf-button subtle" disabled={i === n - 1} onClick={() => onMove(i, i + 1)} aria-label="Move down">
				↓
			</button>
		</span>
	);
}

const moved = <T,>(list: T[], from: number, to: number) => {
	const next = [...list];
	const [item] = next.splice(from, 1);
	next.splice(to, 0, item);
	return next;
};

// ───────────────────────────── Page ─────────────────────────────

function PageTab({ b, onSaved }: { b: FamilyBundle; onSaved: () => void }) {
	const initial = useMemo(() => Object.fromEntries(EDITABLE.map((k) => [k, b.family[k]])) as FamilyFields, [b.family]);
	const [form, setForm] = useState(initial);
	const dirty = JSON.stringify(form) !== JSON.stringify(initial);
	const resend = b.family.status === 'needs_correction';
	return (
		<>
			<section class="pf-section">
				<header class="pf-section-head">
					<h2>Family page</h2>
				</header>
				<div class="pf-grid">
					<FamilyForm value={form} onChange={setForm} nameLocked={b.family.status === 'approved'} />
				</div>
			</section>
			<SaveBar
				dirty={dirty || resend}
				problems={familyProblems(form)}
				onSave={async () => {
					await updateFamily(b.family.id, { ...form, ...(resend ? { status: 'pending' as const } : {}) });
					onSaved();
				}}
				extra={resend ? <span class="pf-help">Saving sends it back to the admins.</span> : undefined}
			/>
		</>
	);
}

// ───────────────────────────── Divisions ─────────────────────────────

function DivisionsTab({ b, onSaved }: { b: FamilyBundle; onSaved: () => void }) {
	const initial = useMemo<DivisionDraft[]>(() => b.divisions.map(({ family_id, ...d }) => d), [b.divisions]);
	const [rows, setRows] = useState(initial);
	const dirty = JSON.stringify(rows) !== JSON.stringify(initial);
	const set = (i: number, patch: Partial<DivisionDraft>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
	return (
		<>
			<section class="pf-section">
				<header class="pf-section-head">
					<h2>Divisions</h2>
				</header>
				<p class="pf-intro">Groups inside the family, like the Brando Clan's Phalanxes. Put members into them on the Roster tab.</p>
				{rows.map((d, i) => (
					<div class="fm-edit-row" key={d.id ?? `new-${i}`}>
						<div class="pf-grid">
							<div class="pf-field">
								<label class="pf-label" for={`div-name-${i}`}>
									Name
								</label>
								<input id={`div-name-${i}`} value={d.name} onInput={(e) => set(i, { name: e.currentTarget.value })} />
							</div>
							<div class="pf-field">
								<label class="pf-label" for={`div-open-${i}`}>
									Open spots
								</label>
								<input id={`div-open-${i}`} type="number" min={0} max={50} value={d.open_spots} onInput={(e) => set(i, { open_spots: Math.max(0, Math.min(50, Number(e.currentTarget.value) || 0)) })} />
							</div>
							<label class="pf-check">
								<input type="checkbox" checked={d.head_open} onChange={(e) => set(i, { head_open: e.currentTarget.checked })} />
								The head spot is open
							</label>
							<div class="pf-field pf-wide">
								<label class="pf-label" for={`div-desc-${i}`}>
									Description
								</label>
								<textarea id={`div-desc-${i}`} rows={2} value={d.description} onInput={(e) => set(i, { description: e.currentTarget.value })} />
							</div>
						</div>
						<div class="fm-edit-row-tools">
							<Move i={i} n={rows.length} onMove={(a, c) => setRows(moved(rows, a, c))} />
							<button type="button" class="pf-button subtle" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
								Remove
							</button>
						</div>
					</div>
				))}
				<button type="button" class="pf-button" onClick={() => setRows([...rows, { name: '', description: '', open_spots: 0, head_open: false, sort: rows.length + 1 }])}>
					+ Add division
				</button>
			</section>
			<SaveBar
				dirty={dirty}
				problems={rows.some((r) => !r.name.trim()) ? ['Every division needs a name.'] : []}
				onSave={async () => {
					await saveDivisions(b.family.id, b.divisions, rows);
					onSaved();
				}}
			/>
		</>
	);
}

// ───────────────────────────── Roster ─────────────────────────────

function RosterTab({ b, onSaved }: { b: FamilyBundle; onSaved: () => void }) {
	const requests = b.members.filter((m) => m.status === 'requested');
	const active = b.members.filter((m) => m.status === 'active');
	const initial = useMemo<MemberDraft[]>(
		() => active.map((m) => ({ id: m.id, name: m.name, division_id: m.division_id, title: m.title, relationship: m.relationship, image_url: m.image_url, sort: m.sort, character_id: m.character_id })),
		[b.members],
	);
	const [rows, setRows] = useState(initial);
	const [busy, setBusy] = useState('');
	const [error, setError] = useState('');
	const dirty = JSON.stringify(rows) !== JSON.stringify(initial);
	const set = (i: number, patch: Partial<MemberDraft>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

	async function act(id: string, action: () => Promise<void>) {
		setBusy(id);
		setError('');
		try {
			await action();
			onSaved();
		} catch (e) {
			setError(messageOf(e));
		} finally {
			setBusy('');
		}
	}

	return (
		<>
			<section class="pf-section">
				<header class="pf-section-head">
					<h2>Join requests</h2>
					<span class="pf-badge">{requests.length}</span>
				</header>
				{requests.length === 0 ? (
					<p class="pf-empty">No requests right now.</p>
				) : (
					<ul class="fm-requests">
						{requests.map((m) => (
							<li key={m.id}>
								<div>
									<strong>{m.name}</strong>
									<span class="fm-member-sub"> · asked {new Date(m.created_at).toLocaleDateString()}</span>
									{m.message && <p class="fm-request-msg">“{m.message}”</p>}
								</div>
								<span class="pf-confirm">
									<button type="button" class="pf-button primary" disabled={busy === m.id} onClick={() => act(m.id, () => acceptMember(m.id))}>
										Accept
									</button>
									<button type="button" class="pf-button subtle" disabled={busy === m.id} onClick={() => act(m.id, () => removeMember(m.id))}>
										Decline
									</button>
								</span>
							</li>
						))}
					</ul>
				)}
				{error && <p class="portal-error">{error}</p>}
			</section>

			<section class="pf-section">
				<header class="pf-section-head">
					<h2>Roster</h2>
					<span class="pf-badge">{rows.length}</span>
				</header>
				<p class="pf-intro">
					Characters who joined through the portal are marked <span class="fm-tag">OC</span>. You can also type in names, for members from before the portal. Removing someone takes them off the roster completely.
				</p>
				{rows.map((m, i) => (
					<div class="fm-edit-row" key={m.id ?? `new-${i}`}>
						<div class="pf-grid fm-roster-grid">
							<div class="pf-field">
								<label class="pf-label" for={`m-name-${i}`}>
									Name {m.character_id && <span class="fm-tag">OC</span>}
								</label>
								<input id={`m-name-${i}`} value={m.name} disabled={Boolean(m.character_id)} onInput={(e) => set(i, { name: e.currentTarget.value })} />
							</div>
							<div class="pf-field">
								<label class="pf-label" for={`m-div-${i}`}>
									Division
								</label>
								<select id={`m-div-${i}`} value={m.division_id ?? ''} onChange={(e) => set(i, { division_id: e.currentTarget.value || null })}>
									<option value="">None</option>
									{b.divisions.map((d) => (
										<option key={d.id} value={d.id}>
											{d.name}
										</option>
									))}
								</select>
							</div>
							<div class="pf-field">
								<label class="pf-label" for={`m-title-${i}`}>
									Title
								</label>
								<input id={`m-title-${i}`} value={m.title} maxLength={60} placeholder="e.g. Head" onInput={(e) => set(i, { title: e.currentTarget.value })} />
							</div>
							<div class="pf-field">
								<label class="pf-label" for={`m-rel-${i}`}>
									Relationship to the Head
								</label>
								<input id={`m-rel-${i}`} value={m.relationship} maxLength={60} placeholder="e.g. Daughter" onInput={(e) => set(i, { relationship: e.currentTarget.value })} />
							</div>
							{!m.character_id && (
								<div class="pf-field pf-wide">
									<label class="pf-label" for={`m-img-${i}`}>
										Picture link
									</label>
									<input id={`m-img-${i}`} type="url" value={m.image_url} placeholder="https://… (optional)" onInput={(e) => set(i, { image_url: e.currentTarget.value.trim() })} />
								</div>
							)}
						</div>
						<div class="fm-edit-row-tools">
							<Move i={i} n={rows.length} onMove={(a, c) => setRows(moved(rows, a, c))} />
							<button type="button" class="pf-button subtle" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
								Remove
							</button>
						</div>
					</div>
				))}
				<button type="button" class="pf-button" onClick={() => setRows([...rows, { name: '', division_id: null, title: '', relationship: '', image_url: '', sort: rows.length + 1 }])}>
					+ Add a name
				</button>
			</section>
			<SaveBar
				dirty={dirty}
				problems={[
					...(rows.some((r) => !r.name.trim()) ? ['Every member needs a name.'] : []),
					...(rows.some((r) => r.image_url && !/^https:\/\//.test(r.image_url)) ? ['Picture links must start with https://'] : []),
				]}
				onSave={async () => {
					await saveRoster(b.family.id, active, rows);
					onSaved();
				}}
			/>
		</>
	);
}

// ───────────────────────────── Relations ─────────────────────────────

function RelationsTab({ b, families, onSaved }: { b: FamilyBundle; families: { id: string; name: string }[]; onSaved: () => void }) {
	const initial = useMemo<RelationDraft[]>(() => b.relations.map(({ family_id, ...r }) => r), [b.relations]);
	const initialNotes = useMemo(() => Object.fromEntries(b.notes.map((n) => [n.standing, n.note])) as Partial<Record<Standing, string>>, [b.notes]);
	const [rows, setRows] = useState(initial);
	const [notes, setNotes] = useState(initialNotes);
	const dirty = JSON.stringify(rows) !== JSON.stringify(initial) || JSON.stringify(notes) !== JSON.stringify(initialNotes);
	const set = (i: number, patch: Partial<RelationDraft>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
	const others = families.filter((f) => f.id !== b.family.id);
	return (
		<>
			<section class="pf-section">
				<header class="pf-section-head">
					<h2>Relations</h2>
				</header>
				<p class="pf-intro">Your family's standing towards others. Families not on the site yet can be typed in.</p>
				<datalist id="fm-family-names">
					{others.map((f) => (
						<option key={f.id} value={f.name} />
					))}
				</datalist>
				{rows.map((r, i) => (
					<div class="fm-edit-row" key={r.id ?? `new-${i}`}>
						<div class="pf-grid">
							<div class="pf-field">
								<label class="pf-label" for={`r-name-${i}`}>
									Family
								</label>
								<input
									id={`r-name-${i}`}
									list="fm-family-names"
									value={r.other_name}
									onInput={(e) => {
										const name = e.currentTarget.value;
										set(i, { other_name: name, other_family_id: others.find((f) => f.name.toLowerCase() === name.trim().toLowerCase())?.id ?? null });
									}}
								/>
								{r.other_family_id && <p class="pf-help">Linked to their page.</p>}
							</div>
							<div class="pf-field">
								<label class="pf-label" for={`r-standing-${i}`}>
									Standing
								</label>
								<select id={`r-standing-${i}`} value={r.standing} onChange={(e) => set(i, { standing: e.currentTarget.value as Standing })}>
									{STANDINGS.map((s) => (
										<option key={s.id} value={s.id}>
											{s.label}
										</option>
									))}
								</select>
							</div>
							<div class="pf-field">
								<label class="pf-label" for={`r-note-${i}`}>
									Note
								</label>
								<input id={`r-note-${i}`} value={r.note} maxLength={300} placeholder="Optional" onInput={(e) => set(i, { note: e.currentTarget.value })} />
							</div>
						</div>
						<div class="fm-edit-row-tools">
							<Move i={i} n={rows.length} onMove={(a, c) => setRows(moved(rows, a, c))} />
							<button type="button" class="pf-button subtle" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
								Remove
							</button>
						</div>
					</div>
				))}
				<button type="button" class="pf-button" onClick={() => setRows([...rows, { other_name: '', other_family_id: null, standing: 'neutral', note: '', sort: rows.length + 1 }])}>
					+ Add relation
				</button>
			</section>
			<section class="pf-section">
				<header class="pf-section-head">
					<h2>What standings mean</h2>
				</header>
				<p class="pf-intro">Optional. Shown under each standing on your page, e.g. what Allies may do in your home.</p>
				<div class="pf-grid">
					{STANDINGS.map((s) => (
						<div class="pf-field" key={s.id}>
							<label class="pf-label" for={`sn-${s.id}`}>
								{s.label}
							</label>
							<textarea id={`sn-${s.id}`} rows={2} maxLength={400} value={notes[s.id] ?? ''} onInput={(e) => setNotes({ ...notes, [s.id]: e.currentTarget.value })} />
						</div>
					))}
				</div>
			</section>
			<SaveBar
				dirty={dirty}
				problems={rows.some((r) => !r.other_name.trim()) ? ['Every relation needs a family name.'] : []}
				onSave={async () => {
					await saveRelations(b.family.id, b.relations, rows);
					await saveStandingNotes(b.family.id, notes);
					onSaved();
				}}
			/>
		</>
	);
}

// ───────────────────────────── Perks ─────────────────────────────

const KIND_ICON: Record<PerkKind, string> = {
	starting_stats: '📈',
	trait: '🧬',
	trait_slots: '➕',
	system_start: '⚡',
	locked_power: '✨',
	technique: '🌀',
	fighting_style: '🥋',
	item: '🎒',
	rolls: '🎲',
	progression: '⏫',
	economy: '💰',
	social: '🛡️',
	other: '◆',
};

const PERK_STATUS = { pending: 'Waiting for an admin', approved: 'Approved', denied: 'Denied' } as const;
const NEW_PERK: PerkDraft = { kind: 'trait', access: 'automatic', title: '', description: '', hidden: false, details: blankDetails('trait') };
const perkFields = (p: PerkDraft): PerkDraft => ({
	id: p.id,
	kind: p.kind,
	access: p.access,
	title: p.title,
	description: p.description,
	hidden: p.hidden,
	// Perks written before the builders existed start the builder fresh.
	details: isBuilt(p.kind) ? { ...blankDetails(p.kind), ...p.details } : {},
});

type PerkRow = { key: string; draft: PerkDraft; saved?: Perk; removed?: boolean; section: string };

function PerkFields({ id, draft, onChange }: { id: string; draft: PerkDraft; onChange: (d: PerkDraft) => void }) {
	const d = draft.details;
	const setDetails = (details: PerkDraft['details']) => onChange({ ...draft, details });
	return (
		<div class="pf-grid fm-perk-form">
			<div class="pf-field pf-wide">
				<label class="pf-label" for={`p-title-${id}`}>
					Name
				</label>
				<input id={`p-title-${id}`} value={draft.title} maxLength={100} onInput={(e) => onChange({ ...draft, title: e.currentTarget.value })} />
			</div>
			<div class="pf-field">
				<label class="pf-label" for={`p-kind-${id}`}>
					Kind
				</label>
				<select
					id={`p-kind-${id}`}
					value={draft.kind}
					onChange={(e) => {
						const kind = e.currentTarget.value as PerkKind;
						onChange({ ...draft, kind, details: blankDetails(kind) });
					}}
				>
					{PERK_KINDS.map((k) => (
						<option key={k.id} value={k.id}>
							{KIND_ICON[k.id]} {k.label}
						</option>
					))}
				</select>
				<p class="pf-help">{PERK_KINDS.find((k) => k.id === draft.kind)?.hint}</p>
			</div>
			<div class="pf-field">
				<label class="pf-label" for={`p-access-${id}`}>
					How members get it
				</label>
				<select id={`p-access-${id}`} value={draft.access} onChange={(e) => onChange({ ...draft, access: e.currentTarget.value as PerkAccess })}>
					{PERK_ACCESS.map((k) => (
						<option key={k.id} value={k.id}>
							{k.label}
						</option>
					))}
				</select>
			</div>
			{draft.kind === 'trait' && (
				<TraitPicker
					value={d}
					onChange={(details) =>
						onChange({ ...draft, details, title: !draft.title.trim() || draft.title === draft.details.trait ? details.trait ?? '' : draft.title })
					}
				/>
			)}
			{draft.kind === 'starting_stats' && d.stats && <StatsBuilder value={d.stats} onChange={(stats) => setDetails({ stats })} />}
			{draft.kind === 'locked_power' && d.ability ? (
				// A Family ability's description lives inside its card.
				<AbilityBuilder value={d.ability} onChange={(ability) => setDetails({ ability })} description={draft.description} onDescription={(description) => onChange({ ...draft, description })} />
			) : (
				<div class="pf-field pf-wide">
					<label class="pf-label" for={`p-desc-${id}`}>
						{draft.kind === 'trait' ? (d.customTrait ? 'What the trait does' : 'Notes (optional)') : draft.kind === 'starting_stats' || isRuleKind(draft.kind) ? 'Description' : 'What it gives'}
					</label>
					<textarea
						id={`p-desc-${id}`}
						rows={4}
						maxLength={8000}
						value={draft.description}
						onInput={(e) => onChange({ ...draft, description: e.currentTarget.value })}
						placeholder={
							draft.kind === 'trait' && !d.customTrait
								? 'Anything about how the family passes this trait on.'
								: 'Effects, limits, cooldowns, and any rolls. **bold** and *italic* work.'
						}
					/>
				</div>
			)}
			{draft.kind === 'trait_slots' && d.traitRules && <TraitRulesBuilder value={d.traitRules} onChange={(traitRules) => setDetails({ traitRules })} />}
			{draft.kind === 'system_start' && d.systemRules && <SystemRulesBuilder value={d.systemRules} onChange={(systemRules) => setDetails({ systemRules })} />}
			{draft.kind === 'fighting_style' && d.style && <StyleBuilder value={d.style} onChange={(style) => setDetails({ style })} />}
			{draft.kind === 'technique' && <TrackerBuilder value={d.tracker} onChange={(tracker) => setDetails(tracker ? { tracker } : {})} />}
			{draft.kind === 'item' && <ItemsBuilder value={d.items ?? []} onChange={(items) => setDetails({ items })} />}
			<label class="pf-check pf-wide">
				<input type="checkbox" checked={draft.hidden} onChange={(e) => onChange({ ...draft, hidden: e.currentTarget.checked })} />
				Members only: hide it from anyone outside the family
			</label>
		</div>
	);
}

const isRuleKind = (k: PerkKind) => k === 'trait_slots' || k === 'system_start' || k === 'fighting_style' || k === 'technique' || k === 'item';

/** One line under a perk's name: its kind, what it gives, and how members get it. */
function perkSubline(d: PerkDraft) {
	const kind = PERK_KINDS.find((k) => k.id === d.kind)?.label ?? 'Perk';
	const what =
		d.kind === 'locked_power' && d.details.ability
			? systemById.get(abilitySystem(d.details.ability))?.label
			: d.kind === 'trait' && d.details.trait
				? `${d.details.trait}${d.details.customTrait ? ' (custom)' : ''}`
				: d.kind === 'system_start' && d.details.systemRules
					? systemById.get(d.details.systemRules.system)?.label
					: d.kind === 'fighting_style'
						? d.details.style?.styleClass
						: '';
	const access = PERK_ACCESS.find((a) => a.id === d.access)?.label.replace(/:.*/, '');
	return [kind, what, access].filter(Boolean).join(' · ');
}

const UNSORTED = '';
/** Where every saved perk sits, to tell whether anything moved. */
type Sec = { id: string; name: string };
const placeKey = (sections: Sec[], rows: PerkRow[]) =>
	JSON.stringify([
		sections.map((x) => x.name),
		rows.filter((r) => r.saved && !r.removed).map((r) => [r.saved!.id, sections.find((x) => x.id === r.section)?.name ?? '', placeIn(rows, r)]),
	]);
const placeIn = (rows: PerkRow[], r: PerkRow) => rows.filter((x) => x.section === r.section && !x.removed).indexOf(r) + 1;

function PerksTab({ b, isAdmin, onSaved }: { b: FamilyBundle; isAdmin: boolean; onSaved: () => void }) {
	const initialSections = useMemo<Sec[]>(() => {
		const named = (b.family.perk_sections ?? []).filter(Boolean);
		// Sections perks use that aren't in the list (e.g. after a rename elsewhere) still show.
		const extra = [...new Set(b.allPerks.map((p) => p.section ?? '').filter((x) => x && !named.includes(x)))];
		return [...named, ...extra].map((name) => ({ id: `s:${name}`, name }));
	}, [b.family.perk_sections, b.allPerks]);
	const initial = useMemo<PerkRow[]>(
		() =>
			[...b.allPerks]
				.sort((x, y) => (x.sort ?? 0) - (y.sort ?? 0))
				.map((p) => ({ key: p.id, draft: perkFields(p), saved: p, section: initialSections.find((x) => x.name === p.section)?.id ?? UNSORTED })),
		[b.allPerks, initialSections],
	);
	const [rows, setRows] = useState(initial);
	const [sections, setSections] = useState(initialSections);
	const [note, setNote] = useState('');
	const [skipReview, setSkipReview] = useState(true);
	const [openKey, setOpenKey] = useState<string | null>(null);
	const approveNow = isAdmin && skipReview;
	const set = (key: string, patch: Partial<PerkRow>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
	const changed = (r: PerkRow) => !r.saved || JSON.stringify(r.draft) !== JSON.stringify(perkFields(r.saved));
	const sending = rows.filter((r) => !r.removed && changed(r));
	const removed = rows.filter((r) => r.removed && r.saved);
	const moved = placeKey(sections, rows) !== placeKey(initialSections, initial);
	const added = sending.filter((r) => !r.saved).length;
	const summary = [added && `${added} new`, sending.length - added && `${sending.length - added} changed`, removed.length && `${removed.length} removed`, moved && 'moved']
		.filter(Boolean)
		.join(' · ');
	const problems = [
		...(sending.some((r) => !r.draft.title.trim()) ? ['Every perk needs a name.'] : []),
		...sending.flatMap((r) => detailProblems(r.draft.kind, r.draft.details, r.draft.title)),
		...(sending.length > 40 ? ['Send at most 40 perks at a time.'] : []),
		...(sections.some((x) => !x.name.trim()) ? ['Every section needs a name.'] : []),
		...(new Set(sections.map((x) => x.name.trim().toLowerCase())).size !== sections.length ? ['Two sections have the same name.'] : []),
	];

	/** Moves a perk one place up or down within its section. */
	function shift(r: PerkRow, by: -1 | 1) {
		const same = rows.filter((x) => x.section === r.section);
		const other = same[same.indexOf(r) + by];
		if (!other) return;
		const i = rows.indexOf(r);
		const j = rows.indexOf(other);
		const next = [...rows];
		[next[i], next[j]] = [next[j], next[i]];
		setRows(next);
	}
	function renameSection(i: number, name: string) {
		setSections(sections.map((x, j) => (j === i ? { ...x, name } : x)));
	}
	function dropSection(i: number) {
		const old = sections[i].id;
		setSections(sections.filter((_, j) => j !== i));
		setRows(rows.map((r) => (r.section === old ? { ...r, section: UNSORTED } : r)));
	}
	function moveSection(i: number, by: -1 | 1) {
		const next = [...sections];
		const j = i + by;
		if (j < 0 || j >= next.length) return;
		[next[i], next[j]] = [next[j], next[i]];
		setSections(next);
	}
	function addPerk(section: string) {
		const key = `new-${Date.now()}`;
		setRows([...rows, { key, draft: { ...NEW_PERK }, section }]);
		setOpenKey(key);
	}

	const shown: Sec[] = [...sections, ...(rows.some((r) => r.section === UNSORTED) || !sections.length ? [{ id: UNSORTED, name: '' }] : [])];

	const perkRow = (r: PerkRow) => {
		const status = r.saved?.status;
		const edited = r.saved && changed(r);
		const same = rows.filter((x) => x.section === r.section);
		const at = same.indexOf(r);
		return (
			<details
				class={`fm-perk-edit${status ? ` perk-${status}` : ''}${r.removed ? ' removed' : ''}`}
				key={r.key}
				open={openKey === r.key}
				onToggle={(e) => {
					const open = (e.currentTarget as HTMLDetailsElement).open;
					if (open) setOpenKey(r.key);
					else if (openKey === r.key) setOpenKey(null);
				}}
			>
				<summary>
					<span class="fm-perk-icon" aria-hidden="true">
						{KIND_ICON[r.draft.kind]}
					</span>
					<span class="fm-perk-edit-text">
						<span class="fm-perk-edit-name">{r.draft.title.trim() || 'New perk'}</span>
						<span class="fm-perk-edit-sub">{perkSubline(r.draft)}</span>
					</span>
					<span class="fm-perk-edit-tags">
						{r.removed ? (
							<span class="fm-chip lock">Will be removed</span>
						) : !r.saved ? (
							<span class="fm-chip">New</span>
						) : edited ? (
							<span class="fm-chip">Changed</span>
						) : (
							status && <span class={`fm-chip state-${status}`}>{PERK_STATUS[status]}</span>
						)}
						{r.draft.hidden && (
							<span class="fm-chip lock" title="Members only">
								🔒
							</span>
						)}
					</span>
				</summary>
				<div class="fm-perk-edit-body">
					{r.saved?.review_note && !edited && <p class="fm-perk-state">Admin note: {r.saved.review_note}</p>}
					{!r.removed && <PerkFields id={r.key} draft={r.draft} onChange={(draft) => set(r.key, { draft })} />}
					<div class="fm-edit-row-tools fm-psec-tools">
						<span class="fm-psec-move">
							<button type="button" class="pf-button subtle" disabled={at === 0} aria-label="Move up" onClick={() => shift(r, -1)}>
								↑
							</button>
							<button type="button" class="pf-button subtle" disabled={at === same.length - 1} aria-label="Move down" onClick={() => shift(r, 1)}>
								↓
							</button>
							{sections.length > 0 && (
								<select aria-label="Move to section" value={r.section} onChange={(e) => set(r.key, { section: e.currentTarget.value })}>
									<option value={UNSORTED}>No section</option>
									{sections.map((x) => (
										<option key={x.id} value={x.id}>
											{x.name || 'Unnamed section'}
										</option>
									))}
								</select>
							)}
						</span>
						{edited && !r.removed && (
							<button type="button" class="pf-button subtle" onClick={() => set(r.key, { draft: perkFields(r.saved!) })}>
								Undo changes
							</button>
						)}
						<button type="button" class="pf-button subtle" onClick={() => (r.saved ? set(r.key, { removed: !r.removed }) : setRows(rows.filter((x) => x.key !== r.key)))}>
							{r.removed ? 'Keep it' : 'Remove'}
						</button>
					</div>
				</div>
			</details>
		);
	};

	return (
		<>
			<section class="pf-section">
				<header class="pf-section-head">
					<h2>Perks</h2>
				</header>
				<p class="pf-intro">
					Sort your perks into sections, like <em>Physical</em>, <em>Traits</em> or <em>Secret Technique</em>. A perk can just be described, or carry rules the site applies
					to members: trait slots, system rules, a fighting style, a tracker. The admins approve each new or changed perk. Moving perks around doesn’t need approval.
				</p>
				{shown.map((sec) => {
					const i = sections.indexOf(sec);
					const list = rows.filter((r) => r.section === sec.id);
					return (
						<div class={`fm-psec${sec.id === UNSORTED ? ' unsorted' : ''}`} key={sec.id || '__unsorted'}>
							<header class="fm-psec-head">
								{sec.id === UNSORTED ? (
									<h3 class="fm-psec-name">{sections.length ? 'No section' : 'Perks'}</h3>
								) : (
									<input class="fm-psec-input" aria-label="Section name" value={sec.name} maxLength={60} placeholder="Section name" onInput={(e) => renameSection(i, e.currentTarget.value)} />
								)}
								<span class="fm-psec-count">{list.filter((r) => !r.removed).length}</span>
								{sec.id !== UNSORTED && (
									<span class="fm-psec-move">
										<button type="button" class="pf-button subtle" disabled={i === 0} aria-label="Move section up" onClick={() => moveSection(i, -1)}>
											↑
										</button>
										<button type="button" class="pf-button subtle" disabled={i === sections.length - 1} aria-label="Move section down" onClick={() => moveSection(i, 1)}>
											↓
										</button>
										<button type="button" class="pf-button subtle" aria-label={`Delete section ${sec.name}`} title="Delete the section (its perks move to No section)" onClick={() => dropSection(i)}>
											✕
										</button>
									</span>
								)}
							</header>
							<div class="fm-psec-list">
								{list.length === 0 && <p class="pf-help">No perks here yet.</p>}
								{list.map(perkRow)}
							</div>
							<button type="button" class="pf-button subtle fm-psec-add" onClick={() => addPerk(sec.id)}>
								+ Add a perk{sec.name.trim() ? ` to ${sec.name.trim()}` : ''}
							</button>
						</div>
					);
				})}
				<button type="button" class="pf-button fm-psec-new" onClick={() => setSections([...sections, { id: `n:${Date.now()}`, name: `Section ${sections.length + 1}` }])}>
					+ Add a section
				</button>
				{isAdmin && (
					<label class="pf-check fm-perk-note">
						<input type="checkbox" checked={skipReview} onChange={(e) => setSkipReview(e.currentTarget.checked)} />
						Approve straight away (admin): untick to send these perks for review instead
					</label>
				)}
				{sending.length > 0 && !approveNow && (
					<div class="pf-field fm-perk-note">
						<label class="pf-label" for="perk-note">
							Note to the admins
						</label>
						<textarea id="perk-note" rows={2} maxLength={2000} value={note} onInput={(e) => setNote(e.currentTarget.value)} placeholder="Optional: anything they should know about these perks" />
					</div>
				)}
			</section>
			<SaveBar
				dirty={sending.length > 0 || removed.length > 0 || moved}
				problems={problems}
				label={sending.length && !approveNow ? `Send ${sending.length} for review` : 'Save'}
				status={summary}
				onSave={async () => {
					const names = sections.map((x) => x.name.trim());
					const placed = (r: PerkRow) => ({ section: sections.find((x) => x.id === r.section)?.name.trim() ?? '', sort: placeIn(rows, r) });
					if (sending.length || removed.length)
						await sendPerks(
							b.family.id,
							sending.map((r) => ({ ...r.draft, ...placed(r) })),
							removed.map((r) => r.saved!.id),
							note,
							approveNow,
						);
					await arrangePerks(
						b.family.id,
						names,
						rows.filter((r) => r.saved && !r.removed && !sending.includes(r)).map((r) => ({ id: r.saved!.id, ...placed(r) })),
					);
					onSaved();
				}}
			/>
		</>
	);
}

// ───────────────────────────── Editor ─────────────────────────────

export default function FamilyEditor({ b, families, isAdmin, onSaved }: { b: FamilyBundle; families: { id: string; name: string }[]; isAdmin: boolean; onSaved: () => void }) {
	const [tab, setTab] = useState<Tab>('page');
	const requests = b.members.filter((m) => m.status === 'requested').length;
	return (
		<>
			<nav class="pf-nav" aria-label="Edit family">
				{TABS.map((t) => (
					<a
						key={t.id}
						href={`#edit-${t.id}`}
						class={tab === t.id ? 'active' : undefined}
						aria-current={tab === t.id ? 'true' : undefined}
						onClick={(e) => {
							e.preventDefault();
							setTab(t.id);
						}}
					>
						{t.label}
						{t.id === 'roster' && requests > 0 && <span class="mc-count"> {requests}</span>}
					</a>
				))}
			</nav>
			{/* Keyed by the data, so a reload after saving resets each tab's draft. */}
			{tab === 'page' && <PageTab key={b.family.updated_at} b={b} onSaved={onSaved} />}
			{tab === 'divisions' && <DivisionsTab key={JSON.stringify(b.divisions)} b={b} onSaved={onSaved} />}
			{tab === 'roster' && <RosterTab key={JSON.stringify(b.members)} b={b} onSaved={onSaved} />}
			{tab === 'inheritance' && <InheritanceTab b={b} />}
			{tab === 'relations' && <RelationsTab key={JSON.stringify([b.relations, b.notes])} b={b} families={families} onSaved={onSaved} />}
			{tab === 'perks' && <PerksTab key={JSON.stringify(b.allPerks)} b={b} isAdmin={isAdmin} onSaved={onSaved} />}
		</>
	);
}
