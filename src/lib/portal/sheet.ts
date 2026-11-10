// The shape of a character sheet as stored in characters.sheet (jsonb).
import { ghoulFromOld } from './ghouls.ts';
import { conduitFromOld } from './conduits.ts';
import { awakeningsFromOld } from './awakenings.ts';
import { techniquesFromOld } from './fireforceLogs.ts';
import { jojoFromPath } from './jojo.ts';
import type { PerkAccess } from '../families/api.ts';
import type { CustomTree } from './customTree.ts';
import { barriersFromOld, ocularFromOld, familyScope, memberKeys, systemById, type Fields } from './systems.ts';

export type SkillType = 'passive' | 'standard' | 'ultimate';

export interface Skill {
	name: string;
	type: SkillType;
	effect: string;
	mastery: string;
	/** The custom skill tree node this skill comes from. */
	treeNodeId?: string;
	/** On the tree but not learned yet: past the starting skills, or added after approval. Unlocked with points. */
	locked?: boolean;
}

/** A card copied from a family's ability perk. The family's part stays locked; the player adds the rest. */
export interface FamilyLink {
	perkId: string;
	familyId: string;
	/** The perk's name when it was linked, shown if the perk is later removed. */
	title: string;
	/** Link proving the character got it, for perks that are rolled, earned or taught. */
	proof: string;
}

/** What a player shows to prove they got a family perk that isn't simply given. */
export const PROOF_LABEL: Record<PerkAccess, string | null> = {
	automatic: null,
	choice: null,
	rolled: null,
	earned: 'Link to the RP where it was earned',
	taught: 'Link to the RP where a member taught it',
};

export interface SystemEntry {
	/** Stable id within the sheet, so priority can point at it. */
	key: string;
	system: string;
	fields: Fields;
	description: string;
	skills: Skill[];
	/** Rolls for this system's rolled fields: field key → Discord message link. */
	rollProofs: Record<string, string>;
	familyLink?: FamilyLink;
	/** The player's own skill tree for this card (optional). */
	customTree?: CustomTree | null;
	/** Asks staff to let this new character start past the usual stats (e.g. Cursed Energy Output). */
	/** A new character asking to start past the usual stats: what they want (stats are set on the card) and why. */
	statOverride?: {
		reason: string;
		ask?: string;
		/** JJK: why the character should start with Barrier Techniques (set once they ask). */
		barrier?: string;
		/** JJK: why the character should start with the Heavenly Restriction they picked (set once they pick one). */
		heavenly?: string;
	} | null;
}

export interface PickedTrait {
	name: string;
	/** Offered by a family: takes a single slot whatever its rarity. */
	family?: boolean;
	/** The family trait perk it's linked to (older sheets only have `family`). */
	perkId?: string;
	familyId?: string;
	/** For a family trait, the proof its perk asks for (if any). Older sheets may hold a roll link. */
	rollProof?: string;
}

/** A character made through a family's Inheritance builder (on the family's page). Only new
 * characters made this way join a family; it's set when the builder starts them. */
export interface Inheritance {
	familyId: string;
	/** The "Members can pick it" perks the player took (perk ids). */
	picks: string[];
	/** Family options the player starts with: "<perk id>|<field>=<value>" (a System rules option). */
	options: string[];
	/** The Potential the player picked, when the family's Trait rules allow picking one. */
	potential: string;
}

export const optionKey = (perkId: string, field: string, value: string) => `${perkId}|${field}=${value}`;

export interface Sheet {
	role?: string;
	age?: string;
	pronouns?: string;
	race?: string;
	appearance: { image: string; description: string; extraImages: string };
	lore: { backstory: string; personality: string; likes: string; dislikes: string; relations: string };
	stats: {
		phase: number;
		strength: string;
		speed: string;
		defense: string;
		stamina: string;
		intelligence: string;
		physicalMeter: number;
		/** PTP earned in RP since the character started. */
		earnedPtp: number;
	};
	/** Filled from the player's roll by the database; `roll` is the 1d500 result. */
	potential: { grade: string; rollProof: string; roll?: number | null };
	traits: PickedTrait[];
	/** Combinations whose reveal animation has already played. */
	seenCombos: string[];
	combat: { info: string; styles: { name: string; rollProof: string }[] };
	systems: SystemEntry[];
	/** key of the SystemEntry that is the priority system. */
	prioritySystem: string;
	storage: string;
	evolutions: { date: string; summary: string; earned: string; link: string }[];
	/** Families the character asks to join when it's submitted (family ids). */
	families: string[];
	/** Set for a character made in a family's Inheritance builder. */
	inheritance?: Inheritance | null;
	/** Canon tryouts only. */
	canon: { portrayal: string; sample: string };
	/** Admin characters: stats in an Error Tier, shown as ERROR to everyone but admins. */
	errorStats?: string[];
}

/** JSON with object keys sorted, so the database's key order doesn't count as a change. */
const stable = (v: unknown): string =>
	Array.isArray(v)
		? `[${v.map(stable).join(',')}]`
		: v && typeof v === 'object'
			? `{${Object.keys(v)
					.sort()
					.map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
					.join(',')}}`
			: JSON.stringify(v ?? null);

/** Whether a linked card still matches its family perk (the family may have changed it since). */
export const sameAbility = (a: { fields: Fields; skills: unknown }, b: { fields: Fields; skills: unknown }, ignore: string[] = []) => {
	const strip = (f: Fields) => Object.fromEntries(Object.entries(f).filter(([k]) => !ignore.includes(k)));
	return stable(strip(a.fields)) === stable(strip(b.fields)) && stable(a.skills) === stable(b.skills);
};

/** Whether the family changed a linked card since it was linked. */
export function familyCardChanged(entry: SystemEntry, ability: { fields: Fields; skills: unknown; parts?: string[] }) {
	const def = systemById.get(entry.system);
	const own = memberKeys(def, ability);
	// Parts the member fills in don't count, nor do the skills when the family leaves them to the member.
	const skills = familyScope(def, ability).skills;
	return !sameAbility({ fields: entry.fields, skills: skills ? entry.skills : [] }, { fields: ability.fields, skills: skills ? ability.skills : [] }, own);
}

export const emptySheet = (): Sheet => ({
	appearance: { image: '', description: '', extraImages: '' },
	lore: { backstory: '', personality: '', likes: '', dislikes: '', relations: '' },
	stats: { phase: 0, strength: '', speed: '', defense: '', stamina: '', intelligence: 'Average', physicalMeter: 0, earnedPtp: 0 },
	potential: { grade: '', rollProof: '' },
	traits: [],
	seenCombos: [],
	combat: { info: '', styles: [] },
	systems: [],
	prioritySystem: '',
	storage: '',
	evolutions: [],
	families: [],
	canon: { portrayal: '', sample: '' },
});

/** Fills in anything missing from an older or partial sheet. */
export function normalizeSheet(raw: unknown): Sheet {
	const base = emptySheet();
	const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<Sheet>;
	return {
		...base,
		...s,
		appearance: { ...base.appearance, ...s.appearance },
		lore: { ...base.lore, ...s.lore },
		stats: { ...base.stats, ...s.stats },
		potential: { ...base.potential, ...s.potential },
		combat: { ...base.combat, ...s.combat, styles: s.combat?.styles ?? [] },
		canon: { ...base.canon, ...s.canon },
		traits: Array.isArray(s.traits) ? s.traits : [],
		seenCombos: Array.isArray(s.seenCombos) ? s.seenCombos : [],
		systems: Array.isArray(s.systems)
			? s.systems.map((e: Partial<SystemEntry>) => {
					const entry: SystemEntry = { key: '', system: '', rollProofs: {}, skills: [], description: '', fields: {}, ...e };
					// JoJo cards from before the rework had a single path.
					if (entry.system === 'jojo') return { ...entry, fields: jojoFromPath(entry.fields) };
					if (entry.system === 'tokyo-ghoul') return { ...entry, fields: ghoulFromOld(entry.fields) };
					if (entry.system === 'quirk') return { ...entry, fields: awakeningsFromOld(entry.fields) };
					if (entry.system === 'fire-force') return { ...entry, fields: techniquesFromOld(entry.fields) };
					if (entry.system === 'jujutsu-kaisen') return { ...entry, fields: ocularFromOld(barriersFromOld(entry.fields)) };
					if (entry.system === 'infamous') return { ...entry, fields: conduitFromOld(entry.fields) };
					return entry;
				})
			: [],
		evolutions: Array.isArray(s.evolutions) ? s.evolutions : [],
		families: Array.isArray(s.families) ? s.families.filter((f): f is string => typeof f === 'string') : [],
		inheritance: normalizeInheritance(s.inheritance),
	};
}

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function normalizeInheritance(raw: unknown): Inheritance | null {
	if (!raw || typeof raw !== 'object') return null;
	const i = raw as Partial<Inheritance>;
	if (typeof i.familyId !== 'string' || !i.familyId) return null;
	return { familyId: i.familyId, picks: strings(i.picks), options: strings(i.options), potential: typeof i.potential === 'string' ? i.potential : '' };
}
