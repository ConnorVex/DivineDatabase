// The two perks members can link on their character: a Family ability, built with the same
// Abilities card as the character form, and a Family trait, picked from the trait list or made
// by the family itself (a custom trait).
// Also the read-only summary shown on the family page and in the admin review.
import { Fragment } from 'preact';
import type { PerkDetails, PerkKind } from '../../lib/families/api.ts';
import { rules, traits } from '../../lib/portal/rules.ts';
import type { Skill } from '../../lib/portal/sheet.ts';
import { systemById, visibleFields, type FieldValue, type Fields } from '../../lib/portal/systems.ts';
import { SelectField, TextField } from '../portal/fields.tsx';
import { FieldInput, SkillsEditor, defaults } from '../portal/SystemsSection.tsx';

const abilities = systemById.get('abilities')!;
const rarities = rules.traitSlots.rarities;
const traitByName = new Map(traits.map((t) => [t.name, t]));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Perk kinds that are built instead of only described. */
export const isBuilt = (kind: PerkKind) => kind === 'locked_power' || kind === 'trait';

/** Starting details for a kind; switching kinds starts the builder fresh. */
export function blankDetails(kind: PerkKind): PerkDetails {
	if (kind === 'locked_power') return { ability: { fields: defaults(abilities.fields), skills: [] } };
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
		const out: string[] = [];
		if (!a || !Array.isArray(a.fields.classes) || !a.fields.classes.length) out.push(`${name}: pick at least one ability class.`);
		if (a?.skills.some((s) => !s.name.trim())) out.push(`${name}: every skill needs a name.`);
		return out;
	}
	return [];
}

function budgetOf(fields: Fields) {
	return { total: abilities.budget!.total(fields), spent: abilities.budget!.spent(fields) };
}

export function AbilityBuilder({ value, onChange }: { value: { fields: Fields; skills: Skill[] }; onChange: (v: { fields: Fields; skills: Skill[] }) => void }) {
	const budget = budgetOf(value.fields);
	const setField = (key: string, v: FieldValue) => onChange({ ...value, fields: { ...value.fields, [key]: v } });
	return (
		<div class="pf-wide system-card perk-ability">
			<header class="system-card-head">
				<h3>Abilities card</h3>
				<span class={`pf-badge ${budget.spent > budget.total ? 'bad' : 'ok'}`}>
					{abilities.budget!.label}: {budget.spent} / {budget.total}
				</span>
			</header>
			<p class="pf-help">
				Built the same way as a character’s Abilities. Members who link it get this card on their sheet; the admins judge anything over the usual limits.
			</p>
			{abilities.notes?.map((n) => (
				<p class="pf-help" key={n}>
					ℹ {n}
				</p>
			))}
			<div class="pf-grid">
				{visibleFields(abilities, value.fields).map((field) => (
					<Fragment key={field.key}>
						<FieldInput field={field} value={value.fields[field.key]} disabled={false} onChange={(v) => setField(field.key, v)} />
					</Fragment>
				))}
				<SkillsEditor
					skills={value.skills}
					disabled={false}
					limits={abilities.startingMoves?.(value.fields)}
					isEvolution={false}
					onUpdate={(fn) => onChange({ ...value, skills: fn(value.skills) })}
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
	if (!a) return null;
	const f = a.fields;
	const budget = budgetOf(f);
	const classes = Array.isArray(f.classes) ? (f.classes as string[]).join(', ') : '';
	return (
		<div class="perk-built">
			<dl class="perk-stats">
				<div>
					<dt>Class</dt>
					<dd>{classes || '—'}</dd>
				</div>
				<div>
					<dt>Power</dt>
					<dd>{String(f.power ?? '—')}</dd>
				</div>
				<div>
					<dt>Range</dt>
					<dd>{String(f.range ?? '—')}</dd>
				</div>
				<div>
					<dt>AUP</dt>
					<dd>{Number(f.upgradePoints) || 0}</dd>
				</div>
				<div>
					<dt>Tier points</dt>
					<dd class={budget.spent > budget.total ? 'over' : undefined}>
						{budget.spent} / {budget.total}
					</dd>
				</div>
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
