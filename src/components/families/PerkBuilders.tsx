// The two perks members can link on their character: a Family ability, a power-system card
// (Abilities, Jujutsu Kaisen, JoJo…) built with the same card as the character form, with the
// family's own starting stats; and a Family trait, picked from the trait list or made by the
// family itself (a custom trait). Also the read-only summary shown on the family page and in
// the admin review.
import { Fragment } from 'preact';
import type { PerkDetails, PerkKind } from '../../lib/families/api.ts';
import { rules, traits } from '../../lib/portal/rules.ts';
import { abilitySystem, groupedFields, systemById, systems, visibleFields, type FieldValue } from '../../lib/portal/systems.ts';
import { SelectField, TextArea, TextField } from '../portal/fields.tsx';
import { FieldInput, SkillsEditor, defaults } from '../portal/SystemsSection.tsx';

type Ability = NonNullable<PerkDetails['ability']>;
const rarities = rules.traitSlots.rarities;
const traitByName = new Map(traits.map((t) => [t.name, t]));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const blank = (v: unknown) => v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/** Perk kinds that are built instead of only described. */
export const isBuilt = (kind: PerkKind) => kind === 'locked_power' || kind === 'trait';

const blankAbility = (system: string): Ability => ({ system, fields: defaults(systemById.get(system)!.fields), skills: [] });

/** Starting details for a kind; switching kinds starts the builder fresh. */
export function blankDetails(kind: PerkKind): PerkDetails {
	if (kind === 'locked_power') return { ability: blankAbility('abilities') };
	if (kind === 'trait') return { trait: '' };
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
		// Rolled fields may be left for each member to roll.
		for (const f of visibleFields(def, a.fields)) if (f.required && !f.rolled && blank(a.fields[f.key])) out.push(`${name}: fill in ${f.label}.`);
		if (a.skills.some((s) => !s.name.trim())) out.push(`${name}: every skill needs a name.`);
		return out;
	}
	return [];
}

export function AbilityBuilder(props: { value: Ability; onChange: (v: Ability) => void; description: string; onDescription: (v: string) => void }) {
	const { value, onChange } = props;
	const system = abilitySystem(value);
	const def = systemById.get(system)!;
	const budget = def.budget ? { total: def.budget.total(value.fields), spent: def.budget.spent(value.fields) } : null;
	const setField = (key: string, v: FieldValue) => onChange({ ...value, fields: { ...value.fields, [key]: v } });
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
			<div class="pf-grid">
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
				{groupedFields(def, value.fields).map((group) => (
					<fieldset class="sys-group pf-wide" key={group.label}>
						<legend>{group.label}</legend>
						<div class="pf-grid">
							{group.fields.map((field) => (
								<Fragment key={field.key}>
									<FieldInput
										field={field.rolled ? { ...field, required: false, help: 'Leave empty to have each member roll it.' } : field}
										value={value.fields[field.key]}
										disabled={false}
										onChange={(v) => setField(field.key, v)}
									/>
								</Fragment>
							))}
						</div>
					</fieldset>
				))}
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
