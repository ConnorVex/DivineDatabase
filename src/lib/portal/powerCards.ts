// Granted powers' cards, without the database: the types, building a card from a power, and
// checking a card against its power. The rules check uses these, so they stay free of the client.
import type { CustomTree } from './customTree.ts';
import type { PowerScaling } from './skillScaling.ts';
import { sameAbility, type Skill, type SystemEntry } from './sheet.ts';
import { familyScope, memberKeys, systemById, type Field, type Fields, type FieldValue } from './systems.ts';

/** The card as an admin built it, like a family ability: { system, fields, skills, parts? }. */
export interface PowerAbility {
	system?: string;
	fields: Fields;
	skills: Skill[];
	parts?: string[];
	/** The power doesn't follow the series' usual scaling: each skill has its own (see skillScaling.ts). */
	scaling?: PowerScaling;
}

export interface CustomPower {
	id: string;
	name: string;
	system: string;
	ability: PowerAbility;
	description: string;
	drawbacks: string;
	tree: CustomTree | null;
	/** The ready-made card (saved by the site), so the database can swap a card when it evolves. */
	card?: SystemEntry | null;
	/** The power this one evolves into, and how (see power_evolutions). */
	evolves_to?: string | null;
	evolution?: EvolutionRules | null;
	created_at: string;
	updated_at: string;
}

/** How a power evolves into the next: a meter on the card, then a lock before it changes. */
export interface EvolutionRules {
	/** The meter's name, e.g. "Metamorphosis". */
	meter: string;
	max: number;
	/** Added by every approved training log that used the card (traits don't change it). */
	perLog: number;
	/** The meter only fills, and Evolve only works, once the card's skill tree is complete. */
	treeFirst: boolean;
	/** The lock after pressing Evolve: this many days, skipped early by this many approved RPs (0 = not used). */
	lockDays: number;
	lockRps: number;
}

export const DEFAULT_EVOLUTION: EvolutionRules = { meter: 'Evolution', max: 100, perLog: 0, treeFirst: false, lockDays: 0, lockRps: 3 };

/** "7 days, or sooner after 3 RPs" */
export function lockText(e: Pick<EvolutionRules, 'lockDays' | 'lockRps'>): string {
	const days = e.lockDays > 0 ? `${e.lockDays} day${e.lockDays === 1 ? '' : 's'}` : '';
	const rps = e.lockRps > 0 ? `${e.lockRps} RP${e.lockRps === 1 ? '' : 's'}` : '';
	if (days && rps) return `${days}, or sooner after ${rps}`;
	return days || rps || 'no wait';
}

/** A grant: on the account while character_id is null, else on that character's card. */
export interface PowerGrant {
	id: number;
	power_id: string;
	profile_id: string;
	character_id: string | null;
	card_key: string | null;
	used_at: string | null;
	note: string;
	granted_at: string;
}

/** A grant as the admin list shows it, with names. */
export interface PowerGrantRow extends PowerGrant {
	power_name: string;
	player_name: string | null;
	character_name: string | null;
}

/** A player's grant with its power, for adding it as a card. */
export interface MyPowerGrant extends PowerGrant {
	power: CustomPower;
}

const newKey = () => Math.random().toString(36).slice(2, 10);

function defaultsOf(fields: Field[]) {
	const out: Record<string, FieldValue> = {};
	for (const f of fields) if (f.default !== undefined) out[f.key] = f.default;
	return out;
}

/** Field keys the player fills in on the power's card (parts left open, rolls left empty). */
export function powerOwnKeys(power: CustomPower): string[] {
	return memberKeys(systemById.get(power.system), power.ability);
}

/** The card a power gives: its stats and skills, locked; its skill tree; and the link back to it. */
export function cardFromPower(power: CustomPower, grantId: number | null): SystemEntry {
	const def = systemById.get(power.system);
	const own = powerOwnKeys(power);
	const ownSkills = !familyScope(def, power.ability).skills;
	const fields: Fields = { ...(def ? defaultsOf(def.fields) : {}), ...structuredClone(power.ability.fields) };
	return {
		key: newKey(),
		system: power.system,
		fields,
		description: '',
		skills: ownSkills ? [] : structuredClone(power.ability.skills ?? []),
		rollProofs: {},
		customTree: power.tree ? structuredClone(power.tree) : null,
		powerLink: { powerId: power.id, grantId, title: power.name, own, ownSkills, about: power.description, drawbacks: power.drawbacks, ...(power.ability.scaling?.custom && power.ability.scaling.tags.length ? { tags: [...power.ability.scaling.tags] } : {}) },
	};
}

/** Puts the power's latest version on its card, keeping what the player filled in. */
export function refreshPowerCard(entry: SystemEntry, power: CustomPower) {
	const fresh = cardFromPower(power, entry.powerLink?.grantId ?? null);
	const own = fresh.powerLink!.own;
	entry.fields = { ...fresh.fields, ...Object.fromEntries(Object.entries(entry.fields).filter(([k]) => own.includes(k))) };
	if (!fresh.powerLink!.ownSkills) entry.skills = fresh.skills;
	entry.customTree = fresh.customTree;
	entry.powerLink = fresh.powerLink;
}

/** Whether the admin changed the power since it was put on this card. */
export function powerCardChanged(entry: SystemEntry, power: CustomPower) {
	const link = entry.powerLink;
	if (!link) return false;
	const fresh = cardFromPower(power, link.grantId);
	const own = fresh.powerLink!.own;
	const skills = !fresh.powerLink!.ownSkills;
	return (
		link.title !== power.name ||
		link.about !== power.description ||
		link.drawbacks !== power.drawbacks ||
		(link.tags ?? []).join('\n') !== (fresh.powerLink!.tags ?? []).join('\n') ||
		!sameAbility({ fields: entry.fields, skills: skills ? entry.skills : [] }, { fields: fresh.fields, skills: skills ? fresh.skills : [] }, own)
	);
}
