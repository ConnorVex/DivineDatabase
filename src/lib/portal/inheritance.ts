// The Inheritance: what a character made through a family's builder gets from the family, how
// that's written onto the sheet, and the checks the family's rules add.
//
// A perk is inherited when it's Guaranteed, when the player took it ("Members can pick it"), or
// when the owner rolled it and the roll won. Earned and Taught perks come later in RP.
// System rules options work the same way: "start" options the player took, "rolled" ones won.
import type { BoardPerk, PerkDetails, SystemOption, SystemRules, TraitRules } from '../families/api.ts';
import { optionKey, type Inheritance, type Sheet, type SystemEntry } from './sheet.ts';
import { abilitySystem, familyScope, memberKeys, systemById, type Fields } from './systems.ts';

export type RollStatus = 'pending' | 'won' | 'lost';

/** A roll the player asked the family owner for: a Rolled perk, or a rolled System rules option. */
export interface InheritanceRoll {
	id: string;
	family_id: string;
	character_id: string;
	player_id: string;
	character_name: string;
	perk_id: string;
	/** '' for the perk itself, or "<field>=<value>" for a System rules option. */
	option: string;
	/** What was asked for, e.g. the perk's title or "Cursed Energy: Vast". */
	label: string;
	status: RollStatus;
	/** A link to the roll (e.g. a Discord message). */
	proof: string;
	note: string;
	created_at: string;
	decided_at: string | null;
}

/** A perk the Inheritance can use: readable (not a locked hidden one) with its kind and access. */
export type ReadablePerk = BoardPerk & { kind: NonNullable<BoardPerk['kind']>; access: NonNullable<BoardPerk['access']> };
export const readable = (p: BoardPerk): p is ReadablePerk => p.unlocked && p.kind !== null && p.access !== null;

const rollOf = (rolls: InheritanceRoll[], perkId: string, option = '') => rolls.find((r) => r.perk_id === perkId && r.option === option);

/** The perks this character inherits. */
export function inheritedPerks(perks: BoardPerk[], inh: Inheritance, rolls: InheritanceRoll[]): ReadablePerk[] {
	return perks.filter(readable).filter((p) => {
		if (p.family_id !== inh.familyId) return false;
		if (p.access === 'automatic') return true;
		if (p.access === 'choice') return inh.picks.includes(p.id);
		if (p.access === 'rolled') return rollOf(rolls, p.id)?.status === 'won';
		return false;
	});
}

/** The System rules options this character starts with, from the perks it inherits. */
export function inheritedOptions(got: ReadablePerk[], inh: Inheritance, rolls: InheritanceRoll[]): { perk: ReadablePerk; rules: SystemRules; option: SystemOption }[] {
	const out: { perk: ReadablePerk; rules: SystemRules; option: SystemOption }[] = [];
	for (const perk of got) {
		const rules = perk.details?.systemRules;
		if (perk.kind !== 'system_start' || !rules) continue;
		for (const option of rules.options) {
			const key = `${option.field}=${option.value}`;
			if (option.access === 'start' && inh.options.includes(optionKey(perk.id, option.field, option.value))) out.push({ perk, rules, option });
			if (option.access === 'rolled' && rollOf(rolls, perk.id, key)?.status === 'won') out.push({ perk, rules, option });
		}
	}
	return out;
}

const STATS = ['strength', 'speed', 'defense', 'stamina', 'intelligence'] as const;

/** What the inherited perks change about the start, for the rule checks. */
export function inheritanceEffects(got: ReadablePerk[]) {
	let extraTraitSlots = 0;
	let bonusPtp = 0;
	const stats: Partial<Record<(typeof STATS)[number], string>> = {};
	const traitRules: TraitRules[] = [];
	for (const p of got) {
		const d: PerkDetails = p.details ?? {};
		if (p.kind === 'trait_slots' && d.traitRules) {
			traitRules.push(d.traitRules);
			extraTraitSlots += Math.max(0, d.traitRules.extraSlots || 0);
		}
		if (p.kind === 'starting_stats' && d.stats) {
			bonusPtp += Math.max(0, d.stats.extraPtp || 0);
			for (const k of STATS) if (d.stats[k]?.trim()) stats[k] = d.stats[k].trim();
		}
	}
	return {
		extraTraitSlots,
		bonusPtp,
		/** Stats the family fixes: set on the sheet and free of the starting limits and PTP. */
		stats,
		/** Regular trait slots are off when any inherited Trait rules say so. */
		regularSlots: traitRules.every((r) => r.regularSlots),
		/** Potentials the player may pick instead of rolling. */
		potentials: [...new Set(traitRules.flatMap((r) => r.potentials))],
		/** Paths the rule checks treat like staff-set values. */
		overrides: Object.fromEntries(Object.keys(stats).map((k) => [`stats.${k}`, { by: 'family' }])) as Record<string, { by: string }>,
	};
}

const copy = <T>(v: T): T => structuredClone(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Writes the inheritance onto the sheet: inherited family traits, family ability cards, fixed
 * stats and fighting styles, a card for each required system with its fixed values, and the
 * picked Potential. Things from this family's perks that aren't inherited (anymore) come off.
 * Returns whether anything changed, so callers can skip a needless update.
 */
export function applyInheritance(
	sheet: Sheet,
	perks: BoardPerk[],
	got: ReadablePerk[],
	newKey: () => string,
	defaultsFor: (systemId: string) => Fields,
): boolean {
	const inh = sheet.inheritance;
	if (!inh) return false;
	const before = JSON.stringify(sheet);
	const ours = new Set(perks.filter((p) => p.family_id === inh.familyId).map((p) => p.id));
	const has = new Set(got.map((p) => p.id));

	// Family traits.
	sheet.traits = sheet.traits.filter((t) => !t.perkId || !ours.has(t.perkId) || has.has(t.perkId));
	for (const p of got) {
		const name = p.kind === 'trait' ? p.details?.trait?.trim() : '';
		if (!name) continue;
		const link = { family: true, perkId: p.id, familyId: p.family_id };
		const existing = sheet.traits.find((t) => t.perkId === p.id) ?? sheet.traits.find((t) => t.name === name);
		if (existing) Object.assign(existing, { name }, link);
		else sheet.traits.push({ name, ...link });
	}

	// Family ability cards: the family's part is copied in, the player fills in the rest.
	sheet.systems = sheet.systems.filter((e) => !e.familyLink || !ours.has(e.familyLink.perkId) || has.has(e.familyLink.perkId));
	for (const p of got) {
		const ability = p.kind === 'locked_power' ? p.details?.ability : undefined;
		const def = ability && systemById.get(abilitySystem(ability));
		if (!ability || !def) continue;
		let card = sheet.systems.find((e) => e.familyLink?.perkId === p.id);
		if (!card) {
			card = { key: newKey(), system: def.id, fields: defaultsFor(def.id), description: '', skills: [], rollProofs: {}, familyLink: { perkId: p.id, familyId: p.family_id, title: p.title, proof: '' } };
			sheet.systems.push(card);
			if (!sheet.prioritySystem) sheet.prioritySystem = card.key;
		}
		const mine = memberKeys(def, ability);
		for (const [k, v] of Object.entries(ability.fields)) if (!mine.includes(k) && !same(card.fields[k], v)) card.fields[k] = copy(v);
		if (familyScope(def, ability).skills && !same(card.skills, ability.skills)) card.skills = copy(ability.skills);
		card.familyLink!.title = p.title;
	}

	// Fixed stats.
	const effects = inheritanceEffects(got);
	for (const [k, v] of Object.entries(effects.stats)) (sheet.stats as unknown as Record<string, string>)[k] = v;

	// Fighting styles the family teaches its members.
	const styleNames = (list: BoardPerk[]) => new Set(list.filter((p) => p.kind === 'fighting_style').map((p) => p.title.trim()).filter(Boolean));
	const allStyles = styleNames(perks.filter((p) => p.family_id === inh.familyId));
	const gotStyles = styleNames(got);
	sheet.combat.styles = sheet.combat.styles.filter((s) => !allStyles.has(s.name.trim()) || gotStyles.has(s.name.trim()));
	for (const name of gotStyles) if (!sheet.combat.styles.some((s) => s.name.trim() === name)) sheet.combat.styles.push({ name, rollProof: '' });

	// Systems the family requires, with the values every member starts with.
	for (const p of got) {
		const rules = p.kind === 'system_start' ? p.details?.systemRules : undefined;
		const def = rules && systemById.get(rules.system);
		if (!rules || !def) continue;
		let card: SystemEntry | undefined = sheet.systems.find((e) => e.system === def.id && !e.familyLink);
		if (!card && rules.required === 'yes') {
			card = { key: newKey(), system: def.id, fields: defaultsFor(def.id), description: '', skills: [], rollProofs: {} };
			sheet.systems.push(card);
			if (!sheet.prioritySystem) sheet.prioritySystem = card.key;
		}
		if (card) for (const [k, v] of Object.entries(rules.fixed ?? {})) if (v !== '' && card.fields[k] !== v) card.fields[k] = v;
	}

	// A picked Potential (the database keeps it only when the family allows it).
	if (inh.potential && effects.potentials.includes(inh.potential) && sheet.potential.grade !== inh.potential) {
		sheet.potential = { ...sheet.potential, grade: inh.potential, rollProof: '' };
	}

	if (!sheet.families.includes(inh.familyId)) sheet.families = [inh.familyId];
	return JSON.stringify(sheet) !== before;
}

export interface InheritanceIssue {
	level: 'error' | 'warning' | 'permission';
	section: string;
	message: string;
}

const fieldLabel = (systemId: string, key: string) => systemById.get(systemId)?.fields.find((f) => f.key === key)?.label ?? key;

/** What the family's rules ask of the sheet. */
export function inheritanceIssues(sheet: Sheet, got: ReadablePerk[], options: ReturnType<typeof inheritedOptions>, familyName: string): InheritanceIssue[] {
	const out: InheritanceIssue[] = [];
	const effects = inheritanceEffects(got);

	if (!effects.regularSlots) {
		const regular = sheet.traits.filter((t) => !t.family);
		if (regular.length) out.push({ level: 'error', section: 'Traits', message: `${familyName} members only use the family’s trait slots: remove ${regular.map((t) => t.name).join(', ')}.` });
	}

	for (const p of got) {
		const rules = p.kind === 'system_start' ? p.details?.systemRules : undefined;
		const def = rules && systemById.get(rules.system);
		if (!rules || !def) continue;
		const cards = sheet.systems.filter((e) => e.system === def.id && !e.familyLink);
		if (!cards.length && rules.required === 'yes') out.push({ level: 'error', section: 'Systems', message: `${familyName} members start with ${def.label}: add a ${def.label} card.` });
		if (!cards.length && rules.required === 'unless')
			out.push({ level: 'permission', section: 'Systems', message: `No ${def.label} card: ${familyName} only allows that when ${rules.unless.trim() || 'the family says so'}.` });
		for (const card of cards) {
			for (const [k, v] of Object.entries(rules.fixed ?? {})) {
				if (v !== '' && String(card.fields[k] ?? '') !== v) out.push({ level: 'error', section: 'Systems', message: `${def.label}: ${familyName} members start with ${fieldLabel(def.id, k)} at ${v}.` });
			}
			for (const o of rules.options) {
				if (String(card.fields[o.field] ?? '') !== o.value) continue;
				const label = `${fieldLabel(def.id, o.field)}: ${o.value}`;
				if (o.access === 'banned') out.push({ level: 'error', section: 'Systems', message: `${def.label}: ${familyName} members can’t have ${label}.` });
				if (o.access === 'rolled' && !options.some((x) => x.option === o)) out.push({ level: 'error', section: 'Systems', message: `${def.label}: ${label} is rolled for in ${familyName}: ask the owner for the roll in the Inheritance.` });
			}
		}
		if (rules.extraPoints > 0)
			out.push({ level: 'permission', section: 'Systems', message: `${familyName}: +${rules.extraPoints} ${rules.pointsLabel.trim() || 'points'} for ${def.label}.` });
		if (rules.moveLimit !== 'default')
			out.push({ level: 'permission', section: 'Systems', message: `${familyName}: ${def.label} starts with ${rules.moveLimit === 'unlimited' ? 'any number of' : `up to ${rules.moveLimit}`} skills.` });
	}

	// Options the family made up (or that change a value the usual list can't hold): the reviewer confirms them.
	for (const { rules, option } of options) {
		const name = systemById.get(rules.system)?.label ?? rules.system;
		out.push({
			level: 'permission',
			section: 'Systems',
			message: `${familyName} ${option.access === 'rolled' ? 'roll won' : 'start'}: ${name} ${fieldLabel(rules.system, option.field)}: ${option.value}${option.detail ? ` (${option.detail})` : ''}.`,
		});
	}
	return out;
}
