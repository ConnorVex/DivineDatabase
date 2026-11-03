// The two perks members can link on their character: a Family ability, built with the same
// Abilities card as the character form, and a Family trait, picked from the trait list.
// Also the read-only summary shown on the family page and in the admin review.
import { Fragment } from 'preact';
import type { PerkDetails, PerkKind } from '../../lib/families/api.ts';
import { rules, traits } from '../../lib/portal/rules.ts';
import type { Skill } from '../../lib/portal/sheet.ts';
import { systemById, visibleFields, type FieldValue, type Fields } from '../../lib/portal/systems.ts';
import { SelectField } from '../portal/fields.tsx';
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
	if (kind === 'trait' && !details.trait) return [`${name}: pick the trait it gives.`];
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

export function TraitPicker({ value, onChange }: { value: string; onChange: (name: string) => void }) {
	const info = traitByName.get(value);
	return (
		<SelectField
			label="Trait"
			required
			value={value}
			placeholder="Pick the trait it gives…"
			onChange={onChange}
			options={rarities.flatMap((r) =>
				traits
					.filter((t) => t.rarity === r.id)
					.map((t) => ({ value: t.name, label: `${t.name} (${cap(t.category)} ${t.effect})`, group: r.label })),
			)}
			help={info ? `${cap(info.rarity)} · ${rules.traitSlots.familyTrait.note}` : rules.traitSlots.familyTrait.note}
		/>
	);
}

const SKILL_TYPE = { passive: 'Passive', standard: 'Standard', ultimate: 'Ultimate' };

/** Read-only view of what a built perk gives. Renders nothing for the other kinds. */
export function PerkBuilt({ kind, details }: { kind: PerkKind | null; details: PerkDetails | undefined }) {
	if (kind === 'trait' && details?.trait) {
		const info = traitByName.get(details.trait);
		return (
			<p class="perk-built">
				<span class="fm-chip">Trait</span> <strong>{details.trait}</strong>
				{info && <span class="pf-help"> · {cap(info.rarity)} {info.category} {info.effect}</span>}
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
