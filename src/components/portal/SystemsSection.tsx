// Power system cards: each system's own stat block, canon picks and skills.
import { Fragment } from 'preact';
import { useState } from 'preact/hooks';
import type { ClaimRow, Universe } from '../../lib/portal/api.ts';
import type { LinkablePerk } from '../../lib/portal/families.ts';
import { cardPath, minimumMoves, rules, systemBudget, systemLimit, type StaffOverrides } from '../../lib/portal/rules.ts';
import { PROOF_LABEL, familyCardChanged, type Sheet, type Skill, type SystemEntry } from '../../lib/portal/sheet.ts';
import { CustomTreeBuilder } from './CustomTreeBuilder.tsx';
import { isTrackedField, TRACKED_HELP } from '../../lib/portal/points.ts';
import { HEAVENLY_SYSTEMS, heavenlyEffect, heavenlyOf } from '../../lib/portal/heavenly.ts';
import { abilitySystem, countsTowardLimit, familyScope, groupedFields, memberKeys, pastStart, startText, systemById, systems, visibleFields, type Field, type FieldValue, type Option } from '../../lib/portal/systems.ts';
import { CheckboxGroup, NumberField, Section, SelectField, TextArea, TextField } from './fields.tsx';
import { RollPanel, type Roller } from './RollPanel.tsx';
import { PinBoxes } from './PinnedNotes.tsx';
import type { PinnedNote } from '../../lib/portal/pins.ts';

interface Props {
	sheet: Sheet;
	update: (fn: (s: Sheet) => void) => void;
	requestedClaims: string[];
	setRequestedClaims: (ids: string[]) => void;
	claimBoard: ClaimRow[];
	universes: Universe[];
	heldClaims: Set<string>;
	comboSystemLimits: Record<string, number>[];
	readOnly: boolean;
	isEvolution: boolean;
	roller: Roller;
	/** Ability perks of the character's families (null while loading). */
	familyAbilities: LinkablePerk[] | null;
	familyName: (id: string) => string;
	/** Cards on the approved sheet: their upgrade point fields come from the wallets. */
	trackedCards?: Set<string>;
	/** The Heavenly Restriction granted for this character (null: none; undefined: not known yet). */
	heavenlyGrant?: string | null;
	/** Values staff set (card:<key>.<field>): locked for the player. */
	staffOverrides?: StaffOverrides;
	/** Notes reviewers pinned to cards (target card:<key>). */
	pins?: PinnedNote[];
}

const newKey = () => Math.random().toString(36).slice(2, 10);

export function defaults(fields: Field[]) {
	const out: Record<string, FieldValue> = {};
	for (const f of fields) if (f.default !== undefined) out[f.key] = f.default;
	return out;
}

export function FieldInput(props: {
	field: Field;
	value: FieldValue | undefined;
	onChange: (v: FieldValue) => void;
	/** For lists: change the latest value, so quick edits to several cells don't overwrite each other. */
	onUpdate?: (fn: (prev: FieldValue | undefined) => FieldValue) => void;
	disabled: boolean;
	blocked?: { value: string; reason: string };
	/** Hold the field at its starting value (a new character without a stat override). */
	atStart?: boolean;
}) {
	const { field, value, onChange, blocked } = props;
	const atStart = props.atStart && field.startsAt !== undefined;
	const label = field.label;
	const help = atStart ? [field.help, `Starts at ${startText(field)}; higher needs a stat override.`].filter(Boolean).join(' ') : field.help;
	const startChoices = atStart && Array.isArray(field.startsAt) ? field.startsAt : null;
	const options = (field.options ?? []).map((o: Option) => {
		const isBlocked = blocked?.value === o.value && value !== o.value;
		const pastStart = Boolean(startChoices && !startChoices.includes(o.value) && value !== o.value);
		const note = isBlocked ? ` (${blocked!.reason})` : pastStart ? ' (override)' : '';
		return { value: o.value, label: `${o.label ?? o.value}${o.permission ? ' 🔑' : ''}${note}`, disabled: isBlocked || pastStart };
	});
	// A number at its start can't go up (it can still come down if it was set higher before).
	const disabled = props.disabled || Boolean(atStart && typeof field.startsAt === 'number' && (Number(value) || 0) <= field.startsAt);
	// A family ability can set its own value outside the list.
	if (field.type === 'select' && value !== undefined && value !== '' && !options.some((o) => o.value === String(value)))
		options.push({ value: String(value), label: `${value} (custom)`, disabled: false });
	switch (field.type) {
		case 'select':
			return <SelectField label={label} help={help} required={field.required} value={String(value ?? '')} options={options} disabled={disabled} onChange={onChange} />;
		case 'multiselect':
			return <CheckboxGroup label={label} help={help} required={field.required} values={Array.isArray(value) ? (value as string[]) : []} options={options} disabled={disabled} onChange={onChange} />;
		case 'number':
			return <NumberField label={label} help={help} required={field.required} min={field.min} value={typeof value === 'number' ? value : Number(value) || 0} disabled={disabled} onInput={onChange} />;
		case 'textarea':
			return <TextArea label={label} help={help} required={field.required} rows={3} value={String(value ?? '')} disabled={disabled} onInput={onChange} />;
		case 'list': {
			const rows = (Array.isArray(value) ? value : []) as Record<string, string>[];
			type Rows = Record<string, string>[];
			// Each edit is applied to the newest rows, not the ones this render saw.
			const set = (fn: (prev: Rows) => Rows) =>
				props.onUpdate ? props.onUpdate((prev) => fn((Array.isArray(prev) ? prev : []) as Rows)) : onChange(fn(rows));
			return (
				<div class="pf-wide pf-list">
					<h4 class="pf-subhead">{label}</h4>
					{rows.map((row, i) => (
						<div class="pf-list-row" key={i}>
							{(field.columns ?? []).map((col) =>
								col.type === 'select' ? (
									<SelectField
										key={col.key}
										label={col.label}
										required={col.required}
										value={row[col.key] ?? ''}
										options={(col.options ?? []).map((o) => ({ value: o.value, label: o.label, group: o.group }))}
										disabled={disabled}
										onChange={(v) => set((prev) => prev.map((r, j) => (j === i ? { ...r, [col.key]: v, ...(col.derive?.(v) ?? {}) } : r)))}
									/>
								) : (
									<TextField
										key={col.key}
										label={col.label}
										required={col.required}
										value={row[col.key] ?? ''}
										disabled={disabled}
										onInput={(v) => set((prev) => prev.map((r, j) => (j === i ? { ...r, [col.key]: v } : r)))}
									/>
								),
							)}
							{!disabled && (
								<button type="button" class="pf-button subtle" onClick={() => set((prev) => prev.filter((_, j) => j !== i))}>
									Remove
								</button>
							)}
						</div>
					))}
					{!disabled && (
						<button type="button" class="pf-button" onClick={() => set((prev) => [...prev, Object.fromEntries((field.columns ?? []).filter((c) => c.default !== undefined).map((c) => [c.key, String(c.default)]))])}>
							+ Add {label.replace(/s$/, '').toLowerCase()}
						</button>
					)}
				</div>
			);
		}
		default:
			return <TextField label={label} help={help} required={field.required} value={String(value ?? '')} disabled={disabled} onInput={onChange} />;
	}
}

type MoveLimits = { standard?: number; ultimate?: number; label?: string };

/** e.g. "needs 1–2 Extension Techniques" or "needs at least 2 Standard skills" */
function describeMoves(limits: MoveLimits, showMax: boolean) {
	const part = (max: number | undefined, name: string) => {
		if (max === undefined) return null;
		const min = minimumMoves(max);
		const plural = (n: number) => `${name}${n === 1 ? '' : 's'}`;
		if (!showMax) return min > 0 ? `at least ${min} ${plural(min)}` : null;
		return min === max ? `${max} ${plural(max)}` : `${min}–${max} ${plural(max)}`;
	};
	return [part(limits.standard, limits.label ?? 'Standard skill'), part(limits.ultimate, 'Ultimate skill')].filter(Boolean).join(' and ');
}

export function SkillsEditor({ skills, onUpdate, disabled, limits, isEvolution }: { skills: Skill[]; onUpdate: (fn: (prev: Skill[]) => Skill[]) => void; disabled: boolean; limits?: MoveLimits; isEvolution: boolean }) {
	// Edits apply to the newest skills, so quick changes to several fields don't overwrite each other.
	const set = (i: number, patch: Partial<Skill>) => onUpdate((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
	// Skills show as one-line rows; tap one to edit it.
	const [editing, setEditing] = useState<number | null>(null);
	const needs = limits ? describeMoves(limits, !isEvolution) : '';
	const standardName = limits?.label ?? 'Standard';
	const typeName = { passive: 'Passive', standard: limits?.label ?? 'Standard', ultimate: 'Ultimate' };
	return (
		<div class="pf-wide pf-list sk-list">
			<h4 class="pf-subhead">
				{limits?.label ? `${limits.label}s & skills` : 'Skills'}
				{needs && <span class="pf-help"> (needs {needs})</span>}
			</h4>
			{skills.length === 0 && <p class="pf-empty">No skills yet.</p>}
			{skills.map((skill, i) =>
				editing !== i ? (
					<button type="button" class={`sk-row ${skill.type}`} key={i} onClick={() => setEditing(i)}>
						<span class="sk-name">{skill.name || <em>Unnamed skill</em>}</span>
						<span class="sk-type">{typeName[skill.type] ?? skill.type}</span>
						{skill.mastery && <span class="sk-mastery">{skill.mastery}</span>}
						{skill.effect && <span class="sk-effect">{skill.effect}</span>}
					</button>
				) : (
					<div class="pf-list-row sk-edit" key={i}>
						<TextField label="Skill name" required value={skill.name} disabled={disabled} onInput={(v) => set(i, { name: v })} />
						<SelectField
							label="Type"
							value={skill.type}
							disabled={disabled}
							onChange={(v) => set(i, { type: (v || 'standard') as Skill['type'] })}
							options={[
								{ value: 'passive', label: 'Passive (free, needs permission) 🔑' },
								{ value: 'standard', label: limits?.label ? `${standardName} (Standard, 10% Stamina)` : 'Standard (10% Stamina)' },
								{ value: 'ultimate', label: 'Ultimate (30% Stamina, 3-turn cooldown)' },
							]}
						/>
						<TextField label="Mastery" value={skill.mastery} disabled={disabled} onInput={(v) => set(i, { mastery: v })} />
						<TextArea label="What it does" rows={3} value={skill.effect} disabled={disabled} onInput={(v) => set(i, { effect: v })} />
						<div class="sk-edit-actions">
							<button type="button" class="pf-button" onClick={() => setEditing(null)}>
								Done
							</button>
							{!disabled && (
								<button
									type="button"
									class="pf-button subtle"
									onClick={() => {
										setEditing(null);
										onUpdate((prev) => prev.filter((_, j) => j !== i));
									}}
								>
									Remove skill
								</button>
							)}
						</div>
					</div>
				),
			)}
			{!disabled && (
				<button
					type="button"
					class="pf-button"
					onClick={() => {
						setEditing(skills.length);
						onUpdate((prev) => [...prev, { name: '', type: 'standard', effect: '', mastery: 'Untrained (0/5)' }]);
					}}
				>
					+ Add skill
				</button>
			)}
		</div>
	);
}

function ClaimPicker(props: { universe: string; label: string; board: ClaimRow[]; picked: string[]; held: Set<string>; onChange: (ids: string[]) => void; disabled: boolean }) {
	const rows = props.board.filter((r) => r.universe === props.universe && r.claim_type === 'ability');
	const mine = rows.filter((r) => props.picked.includes(r.id));
	const full = (r: ClaimRow) => r.max_users !== null && r.used_slots >= r.max_users && !props.held.has(r.id);
	const usage = (r: ClaimRow) => (r.max_users === null ? 'no limit' : `${r.used_slots}/${r.max_users}`);
	return (
		<div class="pf-wide claim-picker">
			<h4 class="pf-subhead">{props.label} (optional)</h4>
			{mine.length > 0 && (
				<ul class="claim-picked">
					{mine.map((r) => (
						<li key={r.id}>
							<strong>{r.name}</strong>
							{rules.permissionClaimCategories.includes(r.category) && <span title="Needs permission"> 🔑</span>}{' '}
							<span class="pf-help">
								{r.category} · {usage(r)}
							</span>
							{!props.disabled && (
								<button type="button" class="pf-button subtle" onClick={() => props.onChange(props.picked.filter((id) => id !== r.id))}>
									Remove
								</button>
							)}
						</li>
					))}
				</ul>
			)}
			{!props.disabled && (
				<SelectField
					label={`Claim a ${props.label.toLowerCase()}`}
					value=""
					placeholder="Pick from the canon list…"
					options={rows
						.filter((r) => !props.picked.includes(r.id))
						.map((r) => ({
							value: r.id,
							label: `${r.name} (${usage(r)}${full(r) ? ', full' : ''})${r.note ? ` · ${r.note}` : ''}${rules.permissionClaimCategories.includes(r.category) ? ' 🔑' : ''}`,
							group: r.category || 'Other',
							disabled: full(r),
						}))}
					onChange={(id) => id && props.onChange([...props.picked, id])}
					help="Full claims can’t be picked. Admins confirm claims when they approve your character."
				/>
			)}
		</div>
	);
}

const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** A closed card's summary: its first few short answers and its skill count. */
function cardChips(def: NonNullable<ReturnType<typeof systemById.get>>, entry: SystemEntry) {
	const answers = visibleFields(def, entry.fields)
		.filter((f) => ['select', 'text', 'number'].includes(f.type ?? 'text'))
		.map((f) => entry.fields[f.key])
		.filter((v) => (typeof v === 'number' ? v > 0 : typeof v === 'string' && v.trim() !== '' && v.length <= 28))
		.map(String)
		.slice(0, 3);
	const skills = entry.skills.length;
	return [...answers, ...(skills ? [`${skills} skill${skills === 1 ? '' : 's'}`] : []), ...(entry.customTree ? ['Skill tree'] : [])];
}

/** The top of a power-system card: make your own, or link one of your families' abilities for this system. */
function AbilitySource(props: {
	entry: SystemEntry;
	abilities: LinkablePerk[] | null;
	familyName: (id: string) => string;
	disabled: boolean;
	onOwn: () => void;
	onLink: (perk: LinkablePerk) => void;
	onProof: (v: string) => void;
}) {
	const { entry, abilities } = props;
	const link = entry.familyLink;
	const perk = link && abilities?.find((p) => p.id === link.perkId);
	if (!link && !abilities?.length) return null;
	const proof = perk && PROOF_LABEL[perk.access];
	const outdated = perk?.details.ability && familyCardChanged(entry, perk.details.ability);
	return (
		<div class="pf-wide ab-source">
			<div class="ab-choice" role="radiogroup" aria-label="Where this ability comes from">
				<button type="button" role="radio" aria-checked={!link} class={!link ? 'active' : undefined} disabled={props.disabled} onClick={() => link && props.onOwn()}>
					Make my own
				</button>
				<button
					type="button"
					role="radio"
					aria-checked={Boolean(link)}
					class={link ? 'active' : undefined}
					disabled={props.disabled || !abilities?.length}
					onClick={() => {
						// With one family ability, link it straight away; otherwise the player picks below.
						if (!link && abilities?.length) props.onLink(abilities.length === 1 ? abilities[0] : { ...abilities[0], id: '', title: '' });
					}}
				>
					Use a family ability
				</button>
			</div>
			{link && (
				<>
					<SelectField
						label="Family ability"
						required
						value={link.perkId}
						placeholder={abilities ? 'Pick one of your families’ abilities…' : 'Loading…'}
						disabled={props.disabled}
						options={(abilities ?? []).map((p) => ({ value: p.id, label: p.title, group: props.familyName(p.family_id) }))}
						onChange={(id) => {
							const next = abilities?.find((p) => p.id === id);
							if (next) props.onLink(next);
						}}
						help="Abilities from the families picked in the Families step, or that this character is already in."
					/>
					{link.perkId && abilities && !perk && (
						<p class="pf-wide roll-note bad">“{link.title}” isn’t available any more: the family removed it, or this character no longer picks that family.</p>
					)}
					{perk && (
						<p class="pf-wide pf-help">
							From <strong>{props.familyName(perk.family_id)}</strong>. Its stats and skills are set by the family; describe how your character uses it below.
						</p>
					)}
					{outdated && !props.disabled && (
						<p class="pf-wide roll-note">
							The family has changed this ability since you linked it.{' '}
							<button type="button" class="pf-button" onClick={() => props.onLink(perk!)}>
								Update the card
							</button>
						</p>
					)}
					{proof && <TextField label={proof} required value={link.proof} placeholder="https://discord.com/channels/…" disabled={props.disabled} onInput={props.onProof} />}
				</>
			)}
		</div>
	);
}

/** A new character asking staff to start past the usual stats. */
function StatOverride({ entry, disabled, onChange }: { entry: SystemEntry; disabled: boolean; onChange: (v: { reason: string } | null) => void }) {
	const on = Boolean(entry.statOverride);
	return (
		<div class={`pf-wide so-box${on ? ' on' : ''}`}>
			<label class="pf-check">
				<input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onChange(e.currentTarget.checked ? { reason: '' } : null)} />
				Request a stat override
			</label>
			{on ? (
				<TextArea
					label="Why (staff approve it)"
					required
					rows={2}
					value={entry.statOverride!.reason}
					disabled={disabled}
					placeholder="e.g. Approved by a staff member in #tickets: link"
					onInput={(v) => onChange({ reason: v })}
				/>
			) : (
				<p class="pf-help">These stats are set for new characters. Higher ones come from a family ability or staff permission.</p>
			)}
		</div>
	);
}

/** Asks on the page itself, since some browsers silently block confirm() pop-ups. */
function RemoveButton({ label, confirmLabel, onConfirm }: { label: string; confirmLabel: string; onConfirm: () => void }) {
	const [asking, setAsking] = useState(false);
	if (!asking)
		return (
			<button type="button" class="pf-button subtle" onClick={() => setAsking(true)}>
				{label}
			</button>
		);
	return (
		<span class="pf-confirm" role="group" aria-label={confirmLabel}>
			<span>{confirmLabel}</span>
			<button type="button" class="pf-button danger" onClick={onConfirm} autoFocus>
				Yes, remove
			</button>
			<button type="button" class="pf-button subtle" onClick={() => setAsking(false)}>
				Cancel
			</button>
		</span>
	);
}

export function SystemsSection(props: Props) {
	const { sheet, update, readOnly } = props;
	const setEntry = (key: string, fn: (e: SystemEntry) => void) =>
		update((s) => {
			const e = s.systems.find((x) => x.key === key);
			if (e) fn(e);
		});

	/** True when the other cards of this system already use up its limited choice (e.g. a second Stand). */
	const heavenly = heavenlyOf(sheet);

	// One card open at a time, and which tab each card is on.
	const [openCard, setOpenCard] = useState<string | null>(sheet.systems[0]?.key ?? null);
	const [tabFor, setTabFor] = useState<Record<string, string>>({});

	const limitedChoiceFull = (entry: SystemEntry) => {
		const def = systemById.get(entry.system);
		const others = sheet.systems.filter((e) => e !== entry && e.system === entry.system && countsTowardLimit(def, e.fields)).length;
		return others >= systemLimit(sheet, entry.system, props.comboSystemLimits);
	};

	return (
		<Section id="systems" title="Power systems" intro="Add a card for each power system your character has. With more than one, pick a priority system.">
			{sheet.systems.length > 1 && (
				<SelectField
					label="Priority system"
					required
					value={sheet.prioritySystem}
					disabled={readOnly}
					onChange={(v) => update((s) => void (s.prioritySystem = v))}
					options={sheet.systems.map((e) => ({ value: e.key, label: systemById.get(e.system)?.label ?? e.system }))}
					help="Non-priority systems pay double Stamina for Standard and Ultimate skills."
				/>
			)}

			{sheet.systems.map((entry) => {
				const def = systemById.get(entry.system);
				if (!def) return null;
				const linked = Boolean(entry.familyLink);
				const linkedAbility = entry.familyLink && props.familyAbilities?.find((p) => p.id === entry.familyLink!.perkId)?.details.ability;
				// On a linked card the member only fills in what the family leaves to them.
				const own = linkedAbility ? memberKeys(def, linkedAbility) : [];
				const tracked = (key: string) => Boolean(props.trackedCards?.has(entry.key)) && isTrackedField(entry.system, key);
				// A Heavenly Restriction comes from a grant (or stays as approved), and sets some fields itself.
				const effect = entry.system === 'jujutsu-kaisen' ? heavenlyEffect(entry.fields.heavenlyRestriction, entry.fields) : null;
				const heavenlyLocked = (key: string) =>
					(key === 'heavenlyRestriction' && (props.isEvolution || props.heavenlyGrant !== null || !effect)) || Boolean(effect && key in effect.fixed);
				const staffSet = (key: string) => Boolean(props.staffOverrides?.[cardPath(entry.key, key)]);
				const fieldLocked = (key: string) => readOnly || (linked && !own.includes(key)) || tracked(key) || heavenlyLocked(key) || staffSet(key);
				const skillsLocked = readOnly || (linked && (!linkedAbility || familyScope(def, linkedAbility).skills));
				const rollOpen = (!linked || own.some((k) => def.fields.find((f) => f.key === k)?.rolled)) && !(effect && 'ceClass' in effect.fixed) && !props.staffOverrides?.[cardPath(entry.key, 'ceClass')];
				const budget = !props.isEvolution && !linked ? systemBudget(sheet, entry) : null;
				const universe = props.universes.find((u) => u.slug === def.universe);
				const groups = groupedFields(def, entry.fields);
				// The roll panel sits in the tab of the group its rolled fields belong to.
				const rollGroup = groups.find((g) => g.fields.some((f) => f.rolled === 'cursed_energy'))?.label;
				const showRoll = Boolean(rollGroup) && rollOpen;
				const claimable = Boolean(def.universe && def.claimLabel) && !effect?.noTechnique;
				const tabs: { id: string; label: string }[] = [
					...groups.filter((g) => g.fields.some((f) => !f.rolled) || (g.label === rollGroup && showRoll)).map((g) => ({ id: `g:${g.label}`, label: g.label })),
					{ id: 'skills', label: `Skills · ${entry.skills.length}` },
					{ id: 'about', label: 'Description' },
					...(claimable ? [{ id: 'claims', label: 'Canon' }] : []),
					...(!readOnly || entry.customTree ? [{ id: 'tree', label: entry.customTree ? 'Skill tree ✓' : 'Skill tree' }] : []),
				];
				const tab = tabs.find((t) => t.id === tabFor[entry.key])?.id ?? tabs[0].id;
				const open = openCard === entry.key || sheet.systems.length === 1;
				const same = sheet.systems.filter((e) => e.system === entry.system);
				const title = same.length > 1 ? `${def.label} ${same.indexOf(entry) + 1}` : def.label;
				const group = groups.find((g) => `g:${g.label}` === tab);
				// New characters start at set stats; a family ability or a stat override can go past them.
				const canOverride = !props.isEvolution && !linked;
				const startHeld = canOverride && !entry.statOverride;
				const groupHasStart = Boolean(group?.fields.some((f) => f.startsAt !== undefined));
				return (
					<article class={`system-card pf-wide${open ? ' open' : ''}`} key={entry.key}>
						<header class="system-card-head">
							<button type="button" class="sc-toggle" aria-expanded={open} disabled={sheet.systems.length === 1} onClick={() => setOpenCard(open ? null : entry.key)}>
								<span class="sc-caret" aria-hidden="true">
									▸
								</span>
								<h3>{title}</h3>
								{!open && (
									<span class="sc-chips">
										{cardChips(def, entry).map((c) => (
											<span class="sc-chip" key={c}>
												{c}
											</span>
										))}
									</span>
								)}
							</button>
							{entry.familyLink && <span class="pf-badge ok">Family ability</span>}
							{budget && budget.total > 0 && (
								<span class={`pf-badge ${budget.spent > budget.total ? 'bad' : 'ok'}`}>
									{budget.label}: {budget.spent} / {budget.total}
								</span>
							)}
							{!readOnly && open && (
								<RemoveButton
									label="Remove"
									confirmLabel={`Remove ${title}?`}
									onConfirm={() =>
										update((s) => {
											s.systems = s.systems.filter((x) => x.key !== entry.key);
											if (s.prioritySystem === entry.key || s.systems.length === 1) s.prioritySystem = s.systems[0]?.key ?? '';
										})
									}
								/>
							)}
						</header>
						<PinBoxes notes={(props.pins ?? []).filter((n) => n.step === 'systems' && n.target === `card:${entry.key}`)} sheet={sheet} />
						{open && (
							<>
								{def.notes?.map((n) => (
									<p class="pf-help" key={n}>
										ℹ {n}
									</p>
								))}
								<AbilitySource
									entry={entry}
									abilities={props.familyAbilities && props.familyAbilities.filter((p) => p.details.ability && abilitySystem(p.details.ability) === entry.system)}
									familyName={props.familyName}
									disabled={readOnly}
									onOwn={() =>
										setEntry(entry.key, (e) => {
											delete e.familyLink;
											e.fields = defaults(def.fields);
											e.skills = [];
										})
									}
									onLink={(perk) =>
										setEntry(entry.key, (e) => {
											const proof = e.familyLink?.proof ?? '';
											if (perk.id && perk.details.ability) {
												// Whatever the family leaves to the member (other parts, open rolls) stays as the member set it.
												const own = memberKeys(def, perk.details.ability);
												const family = Object.entries(copy(perk.details.ability.fields)).filter(([k]) => !own.includes(k));
												e.fields = { ...e.fields, ...Object.fromEntries(family) };
												if (familyScope(def, perk.details.ability).skills) e.skills = copy(perk.details.ability.skills);
											}
											e.familyLink = { perkId: perk.id, familyId: perk.family_id, title: perk.title, proof };
										})
									}
									onProof={(v) => setEntry(entry.key, (e) => void (e.familyLink && (e.familyLink.proof = v)))}
								/>
								<div class="sc-tabs" role="tablist" aria-label={`${title} sections`}>
									{tabs.map((t) => (
										<button type="button" role="tab" key={t.id} aria-selected={t.id === tab} class={`t-${t.id.startsWith('g:') ? 'fields' : t.id}${t.id === tab ? ' active' : ''}`} onClick={() => setTabFor((m) => ({ ...m, [entry.key]: t.id }))}>
											{t.label}
										</button>
									))}
								</div>
								<div class="pf-grid sc-panel" role="tabpanel">
									{group && group.label === rollGroup && showRoll && (
										<RollPanel
											kind="cursed_energy"
											record={props.roller.characterRolls.cursed_energy}
											current={
												entry.fields.ceClass
													? { class: String(entry.fields.ceClass), cep: Number(entry.fields.ceAmount) || 0, level: String(entry.fields.ceLevel ?? '') }
													: null
											}
											characterId={props.roller.characterId}
											myRolls={props.roller.myRolls}
											ensureSaved={props.roller.ensureSaved}
											refresh={props.roller.refresh}
											readOnly={readOnly}
											onRolled={(r) =>
												update((s) => {
													for (const e of s.systems) {
														if (e.system !== entry.system) continue;
														e.fields.ceClass = r.class ?? '';
														e.fields.ceAmount = r.cep ?? 0;
														e.fields.ceLevel = r.level ?? '';
													}
												})
											}
											onCleared={() =>
												update((s) => {
													for (const e of s.systems) {
														if (e.system !== entry.system) continue;
														e.fields.ceClass = '';
														e.fields.ceAmount = 0;
														e.fields.ceLevel = '';
													}
												})
											}
										/>
									)}
									{/* Rolled fields are filled by the roll panel. */}
									{group?.fields
										.filter((field) => !field.rolled)
										.map((field) => (
											<Fragment key={field.key}>
												<FieldInput
													field={staffSet(field.key) ? { ...field, help: 'Set by staff.' } : tracked(field.key) ? { ...field, help: TRACKED_HELP } : field}
													value={entry.fields[field.key]}
													disabled={fieldLocked(field.key)}
													blocked={def.limitedChoice?.key === field.key && limitedChoiceFull(entry) ? { value: def.limitedChoice.value, reason: 'max reached' } : undefined}
													atStart={startHeld}
													onChange={(v) => setEntry(entry.key, (e) => void (e.fields[field.key] = v))}
													onUpdate={(fn) => setEntry(entry.key, (e) => void (e.fields[field.key] = fn(e.fields[field.key])))}
												/>
											</Fragment>
										))}
									{effect && group?.fields.some((f) => f.key === 'heavenlyRestriction') && (
										<div class="pf-wide hr-perks">
											<strong>⛩ {String(entry.fields.heavenlyRestriction)} Heavenly Restriction</strong>
											<ul>
												{effect.perks.map((p) => (
													<li key={p}>{p}</li>
												))}
											</ul>
										</div>
									)}
									{group && groupHasStart && canOverride && (
										<StatOverride
											entry={entry}
											disabled={readOnly}
											onChange={(next) =>
												setEntry(entry.key, (e) => {
													if (next) e.statOverride = next;
													else {
														delete e.statOverride;
														// Back to the starting stats.
														for (const f of def.fields) if (pastStart(f, e.fields[f.key])) e.fields[f.key] = f.default ?? (typeof f.startsAt === 'number' ? f.startsAt : (f.startsAt?.[0] ?? ''));
													}
												})
											}
										/>
									)}
									{tab === 'skills' && (
										<SkillsEditor
											skills={entry.skills}
											disabled={skillsLocked}
											limits={def.startingMoves?.(entry.fields)}
											isEvolution={props.isEvolution}
											onUpdate={(fn) => setEntry(entry.key, (e) => void (e.skills = fn(e.skills)))}
										/>
									)}
									{tab === 'about' && (
										<TextArea
											label={linked ? 'How your character uses it' : 'Description'}
											help={linked ? 'Your character’s take on the family ability, in your own words.' : 'What it is and how it works, in your own words.'}
											rows={5}
											value={entry.description}
											disabled={readOnly}
											onInput={(v) => setEntry(entry.key, (e) => void (e.description = v))}
										/>
									)}
									{tab === 'claims' && (
										<ClaimPicker
											universe={def.universe!}
											label={universe?.ability_label ? `Canon ${universe.ability_label}` : def.claimLabel!}
											board={props.claimBoard}
											picked={props.requestedClaims}
											held={props.heldClaims}
											disabled={readOnly}
											onChange={props.setRequestedClaims}
										/>
									)}
									{tab === 'tree' && <CustomTreeBuilder entry={entry} disabled={readOnly} onChange={(tree) => setEntry(entry.key, (e) => void (e.customTree = tree))} />}
								</div>
							</>
						)}
					</article>
				);
			})}

			{!readOnly && (
				<SelectField
					label="Add a power system"
					value=""
					placeholder="Choose a system to add…"
					options={systems.map((sys) => {
						// Systems where only one choice is limited (JoJo's Stand) can always get another card.
						const limit = systemLimit(sheet, sys.id, props.comboSystemLimits);
						const have = sheet.systems.filter((e) => e.system === sys.id).length;
						const full = !sys.limitedChoice && have >= limit;
						const restricted = Boolean(heavenly) && !HEAVENLY_SYSTEMS.includes(sys.id);
						return {
							value: sys.id,
							label: `${sys.label}${restricted ? ' (Heavenly Restriction)' : full ? ` (only ${limit === 1 ? 'one' : limit} allowed)` : ''}`,
							disabled: full || restricted,
						};
					})}
					help={`${rules.powerSets.unlimited.map((id) => systemById.get(id)?.label).join(' and ')} can be added more than once. Every other system can be added once, unless a trait like Dual Gift allows more.`}
					onChange={(id) =>
						id &&
						update((s) => {
							const def = systemById.get(id)!;
							const key = newKey();
							setOpenCard(key);
							s.systems.push({ key, system: id, fields: defaults(def.fields), description: '', skills: [], rollProofs: {} });
							if (s.systems.length === 1) s.prioritySystem = key;
						})
					}
				/>
			)}
		</Section>
	);
}
