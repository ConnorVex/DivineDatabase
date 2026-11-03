// Perks built instead of only described: a Family ability, a power-system card (Abilities,
// Jujutsu Kaisen, JoJo…) built with the same card as the character form but with the family's
// own values; Starting stats, set like a character's stats; and a Family trait, picked from the
// trait list or made by the family itself. Every list can also take a custom value. Also the
// read-only summary shown on the family page and in the admin review.
import { Fragment } from 'preact';
import { useId, useState } from 'preact/hooks';
import type { PerkDetails, PerkKind } from '../../lib/families/api.ts';
import { rankInfo, ranks, rules, traits } from '../../lib/portal/rules.ts';
import { abilitySystem, familyScope, groupedFields, systemById, systems, visibleFields, type Field, type FieldValue } from '../../lib/portal/systems.ts';
import { NumberField, SelectField, TextArea, TextField } from '../portal/fields.tsx';
import { FieldInput, SkillsEditor, defaults } from '../portal/SystemsSection.tsx';

type Ability = NonNullable<PerkDetails['ability']>;
const rarities = rules.traitSlots.rarities;
const traitByName = new Map(traits.map((t) => [t.name, t]));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const blank = (v: unknown) => v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/** Perk kinds that are built instead of only described. */
export const isBuilt = (kind: PerkKind) => kind === 'locked_power' || kind === 'trait' || kind === 'starting_stats';

const blankAbility = (system: string): Ability => ({ system, fields: defaults(systemById.get(system)!.fields), skills: [] });

/** Starting details for a kind; switching kinds starts the builder fresh. */
export function blankDetails(kind: PerkKind): PerkDetails {
	if (kind === 'locked_power') return { ability: blankAbility('abilities') };
	if (kind === 'trait') return { trait: '' };
	if (kind === 'starting_stats') return { stats: { strength: '', speed: '', defense: '', stamina: '', intelligence: '', extraPtp: 0 } };
	return {};
}

/** What still has to be filled in before a built perk can be sent. */
export function detailProblems(kind: PerkKind, details: PerkDetails, title: string): string[] {
	const name = title.trim() || 'A new perk';
	if (kind === 'trait') {
		if (!details.customTrait) return details.trait ? [] : [`${name}: pick the trait it gives.`];
		const out: string[] = [];
		if (!details.trait?.trim()) out.push(`${name}: give the custom trait a name.`);
		else if (traitByName.has(details.trait.trim())) out.push(`${name}: “${details.trait.trim()}” is already a listed trait, so pick it from the list instead.`);
		if (!details.customTrait.category || !details.customTrait.effect) out.push(`${name}: pick the custom trait’s type and effect.`);
		return out;
	}
	if (kind === 'locked_power') {
		const a = details.ability;
		const def = a && systemById.get(abilitySystem(a));
		if (!a || !def) return [`${name}: pick a power system.`];
		const out: string[] = [];
		const scope = familyScope(def, a);
		if (scope.keys && !scope.keys.size) out.push(`${name}: pick at least one part the family gives.`);
		// Rolled fields may be left for each member to roll; parts the family leaves out are the member's.
		for (const f of visibleFields(def, a.fields))
			if (f.required && !f.rolled && (!scope.keys || scope.keys.has(f.key)) && blank(a.fields[f.key])) out.push(`${name}: fill in ${f.label}.`);
		if (scope.skills && a.skills.some((s) => !s.name.trim())) out.push(`${name}: every skill needs a name.`);
		return out;
	}
	if (kind === 'starting_stats') {
		const st = details.stats;
		if (!st || (!STAT_KEYS.some((k) => st[k].trim()) && !st.intelligence.trim() && !st.extraPtp)) return [`${name}: set at least one stat or some extra tier points.`];
	}
	return [];
}

export function AbilityBuilder(props: { value: Ability; onChange: (v: Ability) => void; description: string; onDescription: (v: string) => void }) {
	const { value, onChange } = props;
	const system = abilitySystem(value);
	const def = systemById.get(system)!;
	const budget = def.budget ? { total: def.budget.total(value.fields), spent: def.budget.spent(value.fields) } : null;
	const setField = (key: string, v: FieldValue) => onChange({ ...value, fields: { ...value.fields, [key]: v } });
	const scope = familyScope(def, value);
	const allParts = def.familyParts?.map((p) => p.label) ?? [];
	const parts = value.parts ?? allParts;
	const togglePart = (label: string) => {
		const next = parts.includes(label) ? parts.filter((p) => p !== label) : allParts.filter((p) => p === label || parts.includes(p));
		// Parts the family leaves out are filled in by each member, so they aren't saved here.
		const keep = familyScope(def, { parts: next }).keys!;
		const fresh = defaults(def.fields);
		const fields = Object.fromEntries(def.fields.filter((f) => keep.has(f.key)).map((f) => [f.key, value.fields[f.key] ?? fresh[f.key]]).filter(([, v]) => v !== undefined));
		const skills = def.familyParts!.some((p) => p.skills && next.includes(p.label)) ? value.skills : [];
		onChange({ ...value, parts: next.length === allParts.length ? undefined : next, fields, skills });
	};
	return (
		<div class="pf-wide system-card perk-ability">
			<header class="system-card-head">
				<h3>{def.label} card</h3>
				{budget && budget.total > 0 && (
					<span class={`pf-badge ${budget.spent > budget.total ? 'bad' : 'ok'}`}>
						{def.budget!.label}: {budget.spent} / {budget.total}
					</span>
				)}
			</header>
			<p class="pf-help">
				Built the same way as a character’s card, but these are the family’s own starting stats instead of the usual defaults. Members who link it get this card on their sheet; the admins judge anything over the usual limits.
			</p>
			{/* Keyed by system, so custom-value pickers start fresh when the system changes. */}
			<div class="pf-grid" key={system}>
				<fieldset class="sys-group pf-wide">
					<legend>System</legend>
					<div class="pf-grid">
						<SelectField
							label="Power system"
							required
							value={system}
							onChange={(v) => v !== system && onChange(blankAbility(v))}
							options={systems.map((s) => ({ value: s.id, label: s.label }))}
							help="Changing the system starts the card fresh."
						/>
						{def.familyParts && (
							<fieldset class="pf-field pf-checks pf-wide perk-parts">
								<legend class="pf-label">What the family gives</legend>
								{def.familyParts.map((p) => (
									<label class="pf-check" key={p.label}>
										<input type="checkbox" checked={parts.includes(p.label)} onChange={() => togglePart(p.label)} />
										{p.label}
									</label>
								))}
								<p class="pf-help">Members fill in the parts left unticked themselves.</p>
							</fieldset>
						)}
						{def.notes?.map((n) => (
							<p class="pf-help pf-wide" key={n}>
								ℹ {n}
							</p>
						))}
					</div>
				</fieldset>
				<fieldset class="sys-group pf-wide">
					<legend>Description</legend>
					<div class="pf-grid">
						<TextArea
							label="What the ability is"
							rows={4}
							value={props.description}
							placeholder="What it does and how it works in the family. **bold** and *italic* work."
							onInput={props.onDescription}
						/>
					</div>
				</fieldset>
				{groupedFields(def, value.fields).filter((group) => !scope.keys || group.fields.some((f) => scope.keys!.has(f.key))).map((group) => (
					<fieldset class="sys-group pf-wide" key={group.label}>
						<legend>{group.label}</legend>
						<div class="pf-grid">
							{group.fields.map((field) => (
								<Fragment key={field.key}>
									<CustomField
										field={field.rolled ? { ...field, required: false, help: 'Leave empty to have each member roll it.' } : field}
										value={value.fields[field.key]}
										onChange={(v) => setField(field.key, v)}
									/>
								</Fragment>
							))}
						</div>
					</fieldset>
				))}
				{scope.skills && (
					<fieldset class="sys-group pf-wide">
						<legend>Skills</legend>
						<div class="pf-grid">
							<SkillsEditor
								skills={value.skills}
								disabled={false}
								limits={def.startingMoves?.(value.fields)}
								isEvolution={false}
								onUpdate={(fn) => onChange({ ...value, skills: fn(value.skills) })}
							/>
						</div>
					</fieldset>
				)}
			</div>
		</div>
	);
}

const CUSTOM_VALUE = '__custom__';

/** A card field that also takes a custom value: lists show their usual values, then “Custom”. */
function CustomField({ field, value, onChange }: { field: Field; value: FieldValue | undefined; onChange: (v: FieldValue) => void }) {
	const listed = (v: unknown) => (field.options ?? []).some((o) => o.value === v);
	const [custom, setCustom] = useState(field.type === 'select' && !blank(value) && !listed(value));
	if (field.type !== 'select') return <FieldInput field={field} value={value} disabled={false} onChange={onChange} />;
	return (
		<>
			<SelectField
				label={field.label}
				help={custom ? undefined : field.help}
				required={field.required}
				value={custom ? CUSTOM_VALUE : String(value ?? '')}
				options={[...(field.options ?? []).map((o) => ({ value: o.value, label: `${o.label ?? o.value}${o.permission ? ' 🔑' : ''}` })), { value: CUSTOM_VALUE, label: '✦ Custom' }]}
				onChange={(v) => {
					setCustom(v === CUSTOM_VALUE);
					onChange(v === CUSTOM_VALUE ? '' : v);
				}}
			/>
			{custom && <TextField label={`Custom ${field.label.toLowerCase()}`} required={field.required} value={String(value ?? '')} placeholder="Type the family’s own value" onInput={onChange} />}
		</>
	);
}

const STAT_KEYS = ['strength', 'speed', 'defense', 'stamina'] as const;
const STAT_LABEL = { strength: 'Strength', speed: 'Speed', defense: 'Defense', stamina: 'Stamina' };
const INTEL = rules.stats.intelligence;
const TOP = Math.max(...ranks.map((r) => r.value));
type Stats = NonNullable<PerkDetails['stats']>;

/** One stat: the usual ranks, “—” to leave it as normal, or a custom value. */
function StatPick(props: { label: string; value: string; options: { value: string; label: string; group?: string }[]; fill: number; detail: string; onChange: (v: string) => void }) {
	const id = useId();
	const listed = !props.value || props.options.some((o) => o.value === props.value);
	const [custom, setCustom] = useState(!listed);
	const groups = [...new Set(props.options.map((o) => o.group ?? ''))];
	const opts = (g: string) => props.options.filter((o) => (o.group ?? '') === g).map((o) => <option key={o.value} value={o.value}>{o.label}</option>);
	return (
		<div class="hud-stat">
			<div class="hud-stat-head">
				<label for={id} class="hud-stat-label">
					{props.label}
				</label>
				<select
					id={id}
					class="hud-stat-select"
					value={custom ? CUSTOM_VALUE : props.value}
					onChange={(e) => {
						const v = e.currentTarget.value;
						setCustom(v === CUSTOM_VALUE);
						props.onChange(v === CUSTOM_VALUE ? '' : v);
					}}
				>
					<option value="">— As normal</option>
					{groups.map((g) => (g ? <optgroup key={g} label={g}>{opts(g)}</optgroup> : opts(g)))}
					<option value={CUSTOM_VALUE}>✦ Custom</option>
				</select>
			</div>
			{custom && <input class="perk-stat-custom" aria-label={`Custom ${props.label}`} value={props.value} placeholder="Type the family’s own value" onInput={(e) => props.onChange(e.currentTarget.value)} />}
			<div class="hud-bar" aria-hidden="true">
				<span style={{ width: `${Math.max(0, Math.min(1, props.fill)) * 100}%` }} />
			</div>
			<p class="hud-stat-detail">{props.detail}</p>
		</div>
	);
}

/** Starting stats, set the same way as on the character form. */
export function StatsBuilder({ value, onChange }: { value: Stats; onChange: (v: Stats) => void }) {
	const rankOptions = ranks.map((r) => ({ value: r.rank, label: `${r.rank} · ${r.value}`, group: `Tier ${r.tier}` }));
	const intelIndex = INTEL.findIndex((i) => i.value === value.intelligence);
	return (
		<div class="pf-wide system-card perk-ability">
			<header class="system-card-head">
				<h3>Starting stats</h3>
				{value.extraPtp > 0 && <span class="pf-badge ok">+{value.extraPtp} PTP</span>}
			</header>
			<p class="pf-help">Members start with these instead of the usual starting ranks. Leave a stat on “As normal” to keep it as usual, or pick “Custom” to type your own value.</p>
			<div class="hud-panel perk-stats-panel">
				<h3 class="hud-panel-title">Parameter tuning</h3>
				{STAT_KEYS.map((k) => {
					const info = rankInfo(value[k]);
					return (
						<StatPick
							key={k}
							label={STAT_LABEL[k]}
							value={value[k]}
							options={rankOptions}
							fill={info ? info.value / TOP : value[k] ? 1 : 0}
							detail={info ? `${info.rank} (${info.value})` : value[k] ? 'Custom value' : 'As normal'}
							onChange={(v) => onChange({ ...value, [k]: v })}
						/>
					);
				})}
				<StatPick
					label="Intelligence"
					value={value.intelligence}
					options={INTEL.map((i) => ({ value: i.value, label: `${i.value}${'permission' in i && i.permission ? ' 🔑' : ''}` }))}
					fill={intelIndex >= 0 ? intelIndex / (INTEL.length - 1) : value.intelligence ? 1 : 0}
					detail={value.intelligence ? (intelIndex >= 0 ? value.intelligence : 'Custom value') : 'As normal'}
					onChange={(v) => onChange({ ...value, intelligence: v })}
				/>
			</div>
			<div class="pf-grid">
				<NumberField
					label="Extra tier points (PTP)"
					min={0}
					value={value.extraPtp}
					onInput={(v) => onChange({ ...value, extraPtp: Math.max(0, v) })}
					help="Points members get on top of their usual starting PTP."
				/>
			</div>
		</div>
	);
}

const CATEGORIES = [...new Set(traits.map((t) => t.category))].sort();
const EFFECTS = [...new Set(traits.map((t) => t.effect))].sort();
const CUSTOM = '__custom__';

/** Pick a listed trait, or make a custom one; its description is the perk's description. */
export function TraitPicker({ value, onChange }: { value: PerkDetails; onChange: (details: PerkDetails) => void }) {
	const custom = value.customTrait;
	const info = custom ? undefined : traitByName.get(value.trait ?? '');
	const setCustom = (patch: Partial<NonNullable<PerkDetails['customTrait']>>) =>
		onChange({ trait: value.trait ?? '', customTrait: { category: '', effect: '', ...custom, ...patch } });
	return (
		<>
			<SelectField
				label="Trait"
				required
				value={custom ? CUSTOM : value.trait ?? ''}
				placeholder="Pick the trait it gives…"
				onChange={(v) => onChange(v === CUSTOM ? { trait: '', customTrait: { category: '', effect: '' } } : { trait: v })}
				options={[
					{ value: CUSTOM, label: '✦ Custom trait (make your own)', group: 'Custom' },
					...rarities.flatMap((r) =>
						traits
							.filter((t) => t.rarity === r.id)
							.map((t) => ({ value: t.name, label: `${t.name} (${cap(t.category)} ${t.effect})`, group: r.label })),
					),
				]}
				help={info ? `${cap(info.rarity)} · ${rules.traitSlots.familyTrait.note}` : rules.traitSlots.familyTrait.note}
			/>
			{custom && (
				<>
					<TextField label="Custom trait name" required value={value.trait ?? ''} onInput={(trait) => onChange({ trait, customTrait: custom })} />
					<SelectField label="Type" required value={custom.category} placeholder="Pick a type…" onChange={(category) => setCustom({ category })} options={CATEGORIES.map((c) => ({ value: c, label: cap(c) }))} />
					<SelectField label="Effect" required value={custom.effect} placeholder="Pick an effect…" onChange={(effect) => setCustom({ effect })} options={EFFECTS.map((e) => ({ value: e, label: cap(e) }))} />
					<p class="pf-help pf-wide">Describe what the trait does in the perk’s description. The admins review custom traits when the perk is sent.</p>
				</>
			)}
		</>
	);
}

const SKILL_TYPE = { passive: 'Passive', standard: 'Standard', ultimate: 'Ultimate' };

const showValue = (v: FieldValue | undefined) =>
	Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : Object.values(x).filter(Boolean).join(' '))).join(', ') : String(v);

/** Read-only view of what a built perk gives. Renders nothing for the other kinds. */
export function PerkBuilt({ kind, details }: { kind: PerkKind | null; details: PerkDetails | undefined }) {
	if (kind === 'trait' && details?.trait) {
		const info = traitByName.get(details.trait);
		const custom = details.customTrait;
		return (
			<p class="perk-built">
				<span class="fm-chip">{custom ? 'Custom trait' : 'Trait'}</span> <strong>{details.trait}</strong>
				{info && !custom && <span class="pf-help"> · {cap(info.rarity)} {info.category} {info.effect}</span>}
				{custom && <span class="pf-help"> · {custom.category} {custom.effect}</span>}
			</p>
		);
	}
	if (kind === 'starting_stats' && details?.stats) {
		const st = details.stats;
		const items = [...STAT_KEYS.map((k) => [STAT_LABEL[k], st[k]]), ['Intelligence', st.intelligence]].filter(([, v]) => v);
		if (st.extraPtp) items.push(['Extra PTP', `+${st.extraPtp}`]);
		if (!items.length) return null;
		return (
			<div class="perk-built">
				<dl class="perk-stats">
					{items.map(([label, v]) => (
						<div key={label}>
							<dt>{label}</dt>
							<dd>{v}</dd>
						</div>
					))}
				</dl>
			</div>
		);
	}
	const a = kind === 'locked_power' ? details?.ability : undefined;
	const def = a && systemById.get(abilitySystem(a));
	if (!a || !def) return null;
	const budget = def.budget ? { total: def.budget.total(a.fields), spent: def.budget.spent(a.fields) } : null;
	return (
		<div class="perk-built">
			<dl class="perk-stats">
				<div>
					<dt>System</dt>
					<dd>{def.label}</dd>
				</div>
				{a.parts && (
					<div>
						<dt>Gives</dt>
						<dd>{a.parts.join(', ')}</dd>
					</div>
				)}
				{visibleFields(def, a.fields)
					.filter((f) => f.type !== 'textarea' && !blank(a.fields[f.key]))
					.map((f) => (
						<div key={f.key}>
							<dt>{f.label}</dt>
							<dd>{showValue(a.fields[f.key])}</dd>
						</div>
					))}
				{budget && budget.total > 0 && (
					<div>
						<dt>{def.budget!.label}</dt>
						<dd class={budget.spent > budget.total ? 'over' : undefined}>
							{budget.spent} / {budget.total}
						</dd>
					</div>
				)}
			</dl>
			{a.skills.length > 0 && (
				<ul class="perk-skills">
					{a.skills.map((s, i) => (
						<li key={i}>
							<strong>{s.name}</strong> <span class="fm-chip">{SKILL_TYPE[s.type]}</span>
							{s.mastery && <span class="pf-help"> · {s.mastery}</span>}
							{s.effect && <p>{s.effect}</p>}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
