// What the submit form asks for on each power system's card, mirrored from the wiki's
// Power Systems pages. Edit here when a system's rules change.
import { TANK_MAX, fearSpent, tankLevel } from './devils.ts';
import { GHOUL_GROWTH_FIELDS, KAGUNES, KAKUJA, gepSpent, hasKagune, isGhoul, isOneEyed, isQuinx } from './ghouls.ts';
import { JOJO_GROWTH_FIELDS, STAND_AWAKENING, STAND_MASTERY, TRACK_KEYS, hasHamon, hasSpin, hasStand, isVampire } from './jojo.ts';
import { ABSORPTION_MAX, EFFICIENCY, FIRE_FORCE_FIELDS, MANIPULATION, OXYGEN_TANK, POWER, TECHNIQUE_KEYS, absorptionRate, hasBurst, hasGrace, isSecond, isThird, levelOptions, numberOptions } from './fireforce.ts';
import { HEAVENLY, heavenlyEffect } from './heavenly.ts';
import { AWAKENING_LOG_FIELD, awakeningLog } from './awakenings.ts';
import { FIRE_FORCE_LOG_FIELDS, linkLog, techniqueLog } from './fireforceLogs.ts';
import { CONDUIT_FIELDS, KARMA_BOMB_RELAYS, conduitMoves, ctpSpent } from './conduits.ts';
import cyberwareData from '../../data/portal/cyberware.json' with { type: 'json' };
import rulesData from '../../data/portal/rules.json' with { type: 'json' };

const cyber = rulesData.cyberware;
const cyberItems = cyberwareData.items;
const cyberSlotOf = new Map(cyberItems.map((i) => [i.name, i.slot]));
import { OTHER_CYBERWARE, extraSlotsOf, slotTotal, slotsOf } from './cyberware.ts';

export type FieldValue = string | number | string[] | Record<string, string>[];
export type Fields = Record<string, FieldValue | undefined>;

export interface Option {
	value: string;
	label?: string;
	/** Points this choice costs from the system's starting budget. */
	points?: number;
	/** Needs admin permission; flagged for reviewers. */
	permission?: boolean;
	/** Only with this trait (e.g. Colossal Ability Power needs Bio-King). */
	trait?: string;
	/** Optional heading the option is listed under. */
	group?: string;
}

export interface Field {
	key: string;
	label: string;
	type: 'select' | 'multiselect' | 'number' | 'text' | 'textarea' | 'list';
	options?: Option[];
	/** For 'list': the columns of each row. */
	columns?: Field[];
	help?: string;
	default?: FieldValue;
	min?: number;
	/** Only shown while another field has one of these values. */
	showIf?: { key: string; in: string[] };
	required?: boolean;
	/** Filled by a roll on the portal (read-only on the card). */
	rolled?: 'cursed_energy';
	/** A new character starts here (the allowed choices, or a number's starting value); going past it
	 * needs a family ability or a stat override staff approve. */
	startsAt?: string[] | number;
	/** Filled in by a roll on the card's tab (read-only unless staff set it). */
	setByRoll?: boolean;
	/** For list columns: other cells to fill in when this one is picked (e.g. an item's slot). */
	derive?: (value: string) => Record<string, string>;
}

/** A move every card of a system has (e.g. Elemental Blast): shown with the skills, not editable. */
export interface DefaultMove {
	name: string;
	type: 'standard' | 'ultimate' | 'passive';
	effect: string;
	cost?: string;
}

export interface SystemDef {
	id: string;
	label: string;
	/** Wiki series slug, for canon claims. */
	universe?: string;
	/** What a canon pick is called here, e.g. 'Stand'. Enables picking from the claim board. */
	claimLabel?: string;
	fields: Field[];
	/** Sections the card's fields are shown in, in order; fields not listed go in a last “Other” section. */
	groups?: { label: string; keys: string[] }[];
	/** Parts of the card a Family ability can give on their own, by group label; members fill in
	 * the parts the family leaves out. Without it a Family ability sets the whole card. */
	familyParts?: { label: string; groups: string[]; skills?: boolean }[];
	/** Starting points to spend on this system's stats. */
	budget?: { label: string; total: (f: Fields) => number; spent: (f: Fields) => number };
	/** Most skills a brand-new character may start with. */
	startingMoves?: (f: Fields) => MoveLimits;
	/** Moves the system always gives (not counted toward the starting skills). */
	defaultMoves?: (f: Fields) => DefaultMove[];
	/** Extra Physical Tiering Points this system grants. */
	ptpBonus?: (f: Fields) => number;
	/** Fields the card's own answers take away (e.g. a Heavenly Restriction). */
	hiddenKeys?: (f: Fields) => string[];
	/** When only some cards count toward the one-per-character limit, e.g. only Stands for JoJo.
	 * Without it, every card of this system counts. */
	limitedChoice?: { key: string; value: string; label: string };
	/** Systems this one can be combined with; others are blocked. */
	onlyWith?: (f: Fields) => string[] | null;
	/** Sets the character's base physical stats instead of PTP. */
	baseStats?: (f: Fields) => { rank: string; stats: string[]; noPtp: boolean } | null;
	/** Extra rule checks for this system; `starting` is true for characters not yet approved. */
	checks?: (f: Fields, starting: boolean) => { level: 'error' | 'warning' | 'permission'; message: string }[];
	notes?: string[];
	/** Parts of the system a new character can only start with if staff permit it. */
	extras?: Extra[];
}

/** A Permission Based start, mirrored from the system's Index pages. */
export interface Extra {
	label: string;
	/** Its Index page, under power-systems/. */
	page: string;
	/** What it is, from that page. */
	about: string;
	fields?: Field[];
}

/** The card field listing its Permission Based starts. */
export const EXTRAS_KEY = 'extras';
export const EXTRAS_GROUP = 'Permission Based';

/** Skills a card may start with. `ultimateCap` limits Ultimates at any time, not only at the start. */
export interface MoveLimits {
	standard?: number;
	ultimate?: number;
	/** What this system calls its Standard skills, e.g. 'Extension Technique'. */
	label?: string;
	/** What this system calls its Ultimate skills, e.g. 'Maximum Technique'. */
	ultimateLabel?: string;
	ultimateCap?: number;
}

const levels = (names: string[], perm: string[] = [], trait?: { trait: string; values: string[] }): Option[] =>
	names.map((value, points) => ({ value, points, permission: perm.includes(value), ...(trait?.values.includes(value) ? { trait: trait.trait } : {}) }));

const indexOf = (options: Option[] | undefined, value: FieldValue | undefined) =>
	Math.max(0, options?.findIndex((o) => o.value === value) ?? 0);

const num = (v: FieldValue | undefined) => (typeof v === 'number' ? v : Number(v) || 0);

const abilityPower = levels(
	['No Power', 'Miniscule', 'Puny', 'Insignificant', 'Trivial', 'Meager', 'Little', 'Small', 'Average', 'Decent', 'Vast', 'Immense', 'Colossal', 'Peak', 'Apex'],
	[],
	// Abilities: Ability Stats.
	{ trait: 'Bio-King', values: ['Colossal', 'Peak', 'Apex'] },
);
const abilityRange = levels(['Physical', 'Close', 'Medium', 'Long', 'Extremely Long']);

const quirkPower = levels(
	['No Power', 'Miniscule', 'Puny', 'Insignificant', 'Trivial', 'Meager', 'Little', 'Small', 'Average', 'Decent', 'Great', 'Plus Variant', 'Maximum Variant', 'Infinite Variant'],
	[],
	// My Hero Academia: Quirk Stats.
	{ trait: 'Quirk Prodigy', values: ['Decent', 'Great'] },
);
/** A Quirk's Variant, from Quirk Instability (My Hero Academia: Quirk Variants). Each opens its own Quirk Power level. */
export const QUIRK_VARIANTS = ['Plus', 'Maximum', 'Infinite'] as const;
const quirkRange = levels(['Physical', 'Close', 'Medium', 'Long']);
// Option labels from the Index (My Hero Academia: Quirk Stats). Stored values stay the level names.
const QUIRK_POWER_STATS: Record<string, string> = {
	'No Power': '0 / 0',
	Miniscule: '2 (1E) / 4 (1C)',
	Puny: '6 (1A) / 8 (2E)',
	Insignificant: '10 (2C) / 12 (2A)',
	Trivial: '14 (3F) / 16 (3C)',
	Meager: '18 (3A) / 20 (4E)',
	Little: '25 (4A) / 30 (5B)',
	Small: '35 (6C) / 40 (7D)',
	Average: '45 (8E) / 50 (8S)',
	Decent: '52 (9E) / 57 (10F)',
	Great: '58 (10E) / 62 (10A)',
	'Plus Variant': '70 (12F) / 74 (12A)',
	'Maximum Variant': '76 (13F) / 80 (13A)',
	'Infinite Variant': '81 (14+)',
};
const QUIRK_RANGE_STATS: Record<string, string> = { Physical: '0 m', Close: '1–5 m', Medium: '10–15 m', Long: '25+ m' };
const withStats = (options: Option[], stats: Record<string, string>): Option[] =>
	options.map((o) => ({ ...o, label: stats[o.value] ? `${o.value}: ${stats[o.value]}` : o.value }));

const standGrades = [
	{ value: 'E', points: 1 },
	{ value: 'D', points: 2 },
	{ value: 'C', points: 3 },
	{ value: 'B', points: 4 },
	{ value: 'A', points: 5 },
	{ value: 'S', points: 6 },
];
const standStats = ['Destructive Power', 'Speed', 'Range', 'Durability', 'Precision', 'Developmental Potential'];
const standKey = (stat: string) => 'stand' + stat.replace(/\s/g, '');

const infamousClasses: Option[] = [
	{ value: 'Elemental', points: 4 },
	{ value: 'Energy', points: 5 },
	{ value: 'Psychic', points: 0 },
	{ value: 'Biologically Enhanced', points: 0 },
	{ value: 'Meta', points: 0, permission: true },
];

/** The card's own name, shown as its title (e.g. a Quirk's name); JJK and Stands use their own name fields. */
const nameField = (label: string, showIf?: Field['showIf']): Field => ({ key: 'name', label, type: 'text', showIf, help: 'Shown as this card’s title.' });

// A Jujutsu Kaisen card can start with only Cursed Energy Utilization: no technique yet.
const JJK_TECHNIQUE = 'Cursed Technique';
const JJK_CEU_ONLY = 'Cursed Energy Utilization only';
const JJK_HAS_TECHNIQUE = { key: 'start', in: [JJK_TECHNIQUE, ''] };

export const systems: SystemDef[] = [
	{
		id: 'abilities',
		label: 'Abilities',
		groups: [
			{ label: 'Ability', keys: ['name', 'classes', 'power', 'range'] },
			{ label: 'Progress', keys: ['upgradePoints'] },
			{ label: 'Metamorphosis', keys: ['metamorphoses', 'metamorphosisNotes'] },
			{ label: 'Overclocking', keys: ['overclockSkills', 'overclockUpgrades'] },
			{ label: 'Underclocking', keys: ['underclockLevel', 'underclockTarget'] },
		],
		fields: [
			nameField('Ability name'),
			{
				key: 'classes',
				label: 'Ability class(es)',
				type: 'multiselect',
				options: [{ value: 'Manipulation' }, { value: 'Generation' }, { value: 'Transformation' }, { value: 'God', permission: true }],
				required: true,
			},
			{ key: 'power', label: 'Ability Power', type: 'select', options: abilityPower, default: 'No Power' },
			{ key: 'range', label: 'Ability Range', type: 'select', options: abilityRange, default: 'Physical' },
			{ key: 'upgradePoints', label: 'Ability Upgrade Points (AUP)', type: 'number', default: 0, min: 0 },
			// Abilities: Ability Evolution, and Overclocking and Underclocking.
			{ key: 'metamorphoses', label: 'Metamorphoses', type: 'number', default: 0, min: 0 },
			{ key: 'metamorphosisNotes', label: 'What each Metamorphosis changed', type: 'textarea', help: 'One per Metamorphosis: how your ability bloomed into its new form.' },
			{ key: 'overclockSkills', label: 'Overclocked skills', type: 'textarea', help: '4 temporary skills you only have while overclocked: 2 Standard and 2 Ultimate.' },
			{
				key: 'overclockUpgrades',
				label: 'Instability upgrades',
				type: 'select',
				options: [
					{ value: '0', label: 'None: +10 Instability per turn' },
					{ value: '1', label: '1 (25 AUP): +8 Instability per turn' },
					{ value: '2', label: '2 (25 AUP): +6 Instability per turn' },
				],
				default: '0',
			},
			{
				key: 'underclockLevel',
				label: 'Underclocking level',
				type: 'select',
				options: [
					{ value: '1', label: 'Level 1: moves 5 Power' },
					{ value: '2', label: 'Level 2 (20 AUP): moves 10 Power' },
					{ value: '3', label: 'Level 3 (20 AUP): moves 15 Power' },
					{ value: '4', label: 'Level 4 (20 AUP): moves 20 Power' },
					{ value: '5', label: 'Level 5 (40 AUP): moves 25 Power' },
				],
			},
			{ key: 'underclockTarget', label: 'Lends power to', type: 'text', help: 'The one other ability this one lends its power to, 1:1.' },
		],
		budget: {
			label: 'Ability Tier Points',
			total: () => 4,
			spent: (f) => indexOf(abilityPower, f.power) + indexOf(abilityRange, f.range),
		},
		startingMoves: () => ({ standard: 2, ultimate: 1 }),
		notes: ['Colossal, Peak and Apex power need the Bio-King trait.'],
	},
	{
		id: 'quirk',
		label: 'My Hero Academia (Quirk)',
		universe: 'my-hero-academia',
		claimLabel: 'Canon Quirk',
		groups: [
			{ label: 'Quirk', keys: ['name', 'type', 'subclass', 'power', 'range', 'factor'] },
			{ label: 'Progress', keys: ['upgradePoints'] },
			{ label: 'Quirk Awakening', keys: ['awakenings', 'awakeningLog'] },
			{ label: 'Quirk Variant', keys: ['variant', 'variantCapabilities'] },
		],
		fields: [
			nameField('Quirk name'),
			{
				key: 'type',
				label: 'Quirk class',
				type: 'select',
				options: [
					{ value: 'Emitter', label: 'Operative (Emitter)' },
					{ value: 'Transformation', label: 'Composite (Transformation)' },
					{ value: 'Mutation', label: 'Heteromorphic (Mutation)' },
				],
				required: true,
			},
			{
				key: 'subclass',
				label: 'Sub-class',
				type: 'select',
				options: [{ value: 'None' }, { value: 'Collective', label: 'Collective (Accumulation)' }],
				default: 'None',
				help: 'Collective Quirks must gather something before they work fully. Only alongside one of the three classes.',
			},
			{ key: 'power', label: 'Quirk Power (Standard / Ultimate)', type: 'select', options: withStats(quirkPower, QUIRK_POWER_STATS), default: 'No Power' },
			{ key: 'range', label: 'Quirk Range', type: 'select', options: withStats(quirkRange, QUIRK_RANGE_STATS), default: 'Physical' },
			{ key: 'factor', label: 'Quirk Factor', type: 'text', help: 'Where your Quirk manifests, e.g. fingertips. Lose that limb and you lose the Quirk.' },
			{ key: 'upgradePoints', label: 'Quirk Upgrade Points (QUP)', type: 'number', default: 0, min: 0 },
			{ key: 'awakenings', label: 'Quirk Awakenings', type: 'number', default: 0, min: 0 },
			AWAKENING_LOG_FIELD,
			{
				key: 'variant',
				label: 'Quirk Variant',
				type: 'select',
				options: [{ value: 'None' }, ...QUIRK_VARIANTS.map((v) => ({ value: v, label: `${v} Variant` }))],
				default: 'None',
				setByRoll: true,
				help: 'Set by your Spontaneous Evolution roll. All Quirk stats reset to the bottom, and Instability is gone for good.',
			},
			{
				key: 'variantCapabilities',
				label: 'Variant capabilities',
				type: 'textarea',
				showIf: { key: 'variant', in: ['Maximum', 'Infinite'] },
				help: 'Maximum: 1 capability no Awakening could give. Infinite: up to 4.',
			},
		],
		checks: (f) => {
			const power = String(f.power ?? '');
			const needs = QUIRK_VARIANTS.find((v) => power === `${v} Variant`);
			const has = QUIRK_VARIANTS.indexOf(f.variant as (typeof QUIRK_VARIANTS)[number]);
			const out: { level: 'error' | 'warning' | 'permission'; message: string }[] = [];
			if (needs && has < QUIRK_VARIANTS.indexOf(needs)) out.push({ level: 'error', message: `Quirk Power ${power} needs the ${needs} Variant.` });
			awakeningLog(f).forEach((a, i) => {
				if (!a.gain || !String(a.detail ?? '').trim()) out.push({ level: 'error', message: `Awakening #${i + 1}: say what it gave (higher Quirk Power or expanded rules, and what).` });
				if (a.how === 'Event' && !String(a.event ?? '').trim()) out.push({ level: 'error', message: `Awakening #${i + 1}: describe the event that helped you understand your Quirk.` });
			});
			return out;
		},
		budget: {
			label: 'Quirk Tier Points',
			total: () => 3,
			spent: (f) => indexOf(quirkPower, f.power) + indexOf(quirkRange, f.range),
		},
		startingMoves: () => ({ standard: 3, ultimate: 2 }),
	},
	{
		id: 'jujutsu-kaisen',
		label: 'Jujutsu Kaisen',
		universe: 'jujutsu-kaisen',
		claimLabel: 'Cursed Technique',
		groups: [
			{ label: 'Start', keys: ['start', 'name'] },
			{ label: 'Heavenly Restriction', keys: ['heavenlyRestriction'] },
			{ label: 'Cursed Energy', keys: ['ceClass', 'ceAmount', 'ceOutput', 'ceControl', 'rp2rpRecharge', 'completeRecharge', 'ceUpgradePoints'] },
			{ label: 'Cursed Technique', keys: ['ctName', 'ctType', 'ctClass', 'ctRange', 'ctPower', 'ctEfficiency', 'ctUpgradePoints'] },
			{ label: 'Restrictions & tools', keys: ['bindingVows', 'cursedTools'] },
		],
		familyParts: [
			{ label: 'Cursed Energy', groups: ['Cursed Energy'] },
			{ label: 'Cursed Technique', groups: ['Cursed Technique'], skills: true },
			{ label: 'Restrictions & tools', groups: ['Restrictions & tools'] },
		],
		fields: [
			nameField('Fighting style name', { key: 'start', in: [JJK_CEU_ONLY] }),
			{
				key: 'start',
				label: 'Start with',
				type: 'select',
				options: [{ value: JJK_TECHNIQUE }, { value: JJK_CEU_ONLY }],
				default: JJK_TECHNIQUE,
				required: true,
				help: 'Cursed Energy Utilization only: no Cursed Technique or Extension Techniques yet.',
			},
			{
				key: 'ceClass',
				label: 'Cursed Energy',
				type: 'select',
				options: [{ value: 'Common' }, { value: 'Uncommon' }, { value: 'Rare' }, { value: 'Legendary' }, { value: 'Mythical' }, { value: 'Heavenly' }, { value: 'Heavenly Twin' }],
				required: true,
				rolled: 'cursed_energy',
			},
			{ key: 'ceAmount', label: 'Cursed Energy Points', type: 'number', min: 0, required: true, rolled: 'cursed_energy' },
			{
				key: 'ceOutput',
				label: 'Cursed Energy Output',
				type: 'select',
				options: levels(['None', 'Extremely Poor', 'Poor', 'Miniscule', 'Small', 'Average', 'Above Average', 'Good', 'High', 'Amazing', 'Extremely High', 'Intense', 'Immense', 'Maximum']).map((o) =>
					o.value === 'None' ? { ...o, label: 'No Output' } : o,
				),
				default: 'None',
				startsAt: ['None'],
			},
			{ key: 'ceControl', label: 'Cursed Energy Control level', type: 'number', default: 0, min: 0, startsAt: 0 },
			{ key: 'rp2rpRecharge', label: 'RP2RP Recharge level', type: 'number', default: 0, min: 0, startsAt: 0 },
			{ key: 'completeRecharge', label: 'Complete Recharge level', type: 'number', default: 0, min: 0, startsAt: 0 },
			{ key: 'ceUpgradePoints', label: 'Cursed Energy Upgrade Points (CEUP)', type: 'number', default: 0, min: 0, startsAt: 0 },
			{ key: 'ctName', label: 'Cursed Technique name', type: 'text', showIf: JJK_HAS_TECHNIQUE },
			{ key: 'ctType', label: 'Cursed Technique type', type: 'select', options: [{ value: 'Innate' }, { value: 'Inherited' }], showIf: JJK_HAS_TECHNIQUE },
			{ key: 'ctClass', label: 'Cursed Technique class', type: 'select', options: [{ value: 'General' }, { value: 'Shikigami' }, { value: 'Support' }], showIf: JJK_HAS_TECHNIQUE },
			{
				key: 'ctRange',
				showIf: JJK_HAS_TECHNIQUE,
				label: 'Cursed Technique Range',
				type: 'select',
				options: levels(['Physical', 'Close', 'Medium', 'Long', 'Impossible', 'Heavenly', 'Unknown'], ['Impossible', 'Heavenly', 'Unknown']),
				default: 'Physical',
				startsAt: ['Physical', 'Close'],
			},
			{
				key: 'ctPower',
				showIf: JJK_HAS_TECHNIQUE,
				label: 'Cursed Technique Power',
				type: 'select',
				options: levels(['Below Grade 4', 'Grade 4', 'Semi Grade 3', 'Grade 3', 'Semi Grade 2', 'Grade 2', 'Semi Grade 1', 'Grade 1', 'Special Grade'], ['Special Grade']),
				default: 'Below Grade 4',
				startsAt: ['Below Grade 4'],
			},
			{
				key: 'ctEfficiency',
				showIf: JJK_HAS_TECHNIQUE,
				label: 'Cursed Technique Efficiency',
				type: 'select',
				options: levels(
					['Extremely Poor', 'Very Poor', 'Poor', 'Subpar', 'Tolerable', 'Average', 'Decent', 'Adequate', 'Great', 'Amazing', 'Insane', 'Remarkable', 'Unparalleled', 'Terrifying', 'Heavenly Twin'],
					['Unparalleled', 'Terrifying', 'Heavenly Twin'],
				),
				default: 'Extremely Poor',
				startsAt: ['Extremely Poor'],
			},
			{ key: 'ctUpgradePoints', label: 'Cursed Technique Upgrade Points (CTUP)', type: 'number', default: 0, min: 0, startsAt: 0, showIf: JJK_HAS_TECHNIQUE },
			{
				key: 'heavenlyRestriction',
				label: 'Heavenly Restriction',
				type: 'select',
				options: [{ value: 'None' }, ...HEAVENLY.map((value) => ({ value, label: `${value} 🔑` }))],
				default: 'None',
				help: 'Permission Based: staff grant it to your account. It locks you out of every power system but JJK and Cyberpunk.',
			},
			{ key: 'bindingVows', label: 'Binding Vows', type: 'textarea' },
			{ key: 'cursedTools', label: 'Cursed Tools', type: 'textarea' },
		],
		// Cursed Energy Utilization alone starts with a single skill and no Maximum Technique.
		startingMoves: (f) => (heavenlyEffect(f.heavenlyRestriction, f)?.noTechnique ? {} : f.start === JJK_CEU_ONLY ? { standard: 1, ultimate: 0 } : { standard: 2, label: 'Extension Technique', ultimateLabel: 'Maximum Technique', ultimateCap: 1 }),
		// The Cursed Energy Restriction gives 9 PTP to build your Heavenly.
		ptpBonus: (f) => heavenlyEffect(f.heavenlyRestriction, f)?.ptp ?? 0,
		hiddenKeys: (f) => heavenlyEffect(f.heavenlyRestriction, f)?.hidden ?? [],
	},
	{
		id: 'jojo',
		label: "JoJo's Bizarre Adventure",
		universe: 'jojo',
		claimLabel: 'Canon Stand',
		groups: [
			{ label: 'Your card', keys: ['name', 'hasStand'] },
			{ label: 'Stand', keys: ['standName', 'standArrow', 'standDestructivePower', 'standSpeed', 'standRange', 'standDurability', 'standPrecision', 'standDevelopmentalPotential'] },
			{ label: 'Stand growth', keys: ['standAwakening', 'standMastery'] },
			{ label: 'Esoteric Ability', keys: ['esotericName', 'esotericAbility'] },
			{ label: 'Canon Stand', keys: ['canonStand'] },
			{ label: 'Hamon', keys: ['hamon', 'hamonTeacher', 'hamonMastery'] },
			{ label: 'Spin', keys: ['spin', 'spinTeacher', 'spinMastery'] },
			{ label: 'Golden & Cavalry Spin', keys: ['goldenSpin', 'enlightenment'] },
			{ label: 'Vampire', keys: ['vampire', 'stoneMask', 'vampireMastery', 'vampireUpgradePoints'] },
			{ label: 'Ultimate Life Form', keys: ['ulf'] },
			{ label: 'Stand Evolution', keys: ['standEvolution', 'standEvolutionNotes'] },
			{ label: 'Upgrades', keys: TRACK_KEYS },
		],
		fields: [
			nameField('Name'),
			{ key: 'hasStand', label: 'Stand', type: 'select', options: [{ value: 'Yes', label: 'Stand user' }, { value: 'No', label: 'No Stand (yet)' }], default: 'Yes', required: true },
			{ key: 'standName', label: 'Stand name', type: 'text', showIf: { key: 'hasStand', in: ['Yes'] }, required: true },
			{ key: 'standArrow', label: 'How you got it', type: 'select', options: [{ value: 'Born with it' }, { value: 'Stand Arrow' }], default: 'Born with it', showIf: { key: 'hasStand', in: ['Yes'] } },
			...standStats.map(
				(stat): Field => ({
					key: standKey(stat),
					label: stat,
					type: 'select',
					options: stat === 'Developmental Potential' ? [...standGrades, { value: '∞', points: 0, permission: true }] : standGrades,
					showIf: { key: 'hasStand', in: ['Yes'] },
					required: true,
				}),
			),
			// The canon Stand this card claims (its stats are canon, outside the starting points).
			{ key: 'canonStand', label: 'Canon Stand', type: 'text' },
			// The Esoteric Ability tab only shows for Stand users.
			{ key: 'esotericName', label: 'Ability name', type: 'text', help: 'Optional, e.g. Za Warudo.' },
			{
				key: 'esotericAbility',
				label: 'What your Stand’s ability does',
				type: 'textarea',
				help: 'Its unique, wild ability: what it can do in a fight and in everyday life, and its limits.',
			},
			{ key: 'standAwakening', label: `Stand Awakening (out of ${STAND_AWAKENING})`, type: 'number', default: 0, min: 0, startsAt: 0, showIf: { key: 'hasStand', in: ['Yes'] } },
			{ key: 'standMastery', label: `Stand Mastery (out of ${STAND_MASTERY})`, type: 'number', default: 0, min: 0, startsAt: 0, showIf: { key: 'hasStand', in: ['Yes'] } },
			{ key: 'hamonMastery', label: 'Hamon Upgrade Points (HUP)', type: 'number', default: 0, min: 0, showIf: { key: 'hamon', in: ['Yes'] } },
			{ key: 'spinMastery', label: 'Spin Upgrade Points (SUP)', type: 'number', default: 0, min: 0, showIf: { key: 'spin', in: ['Yes'] } },
			{ key: 'vampireMastery', label: 'Vampire Mastery', type: 'number', default: 0, min: 0, showIf: { key: 'vampire', in: ['Yes'] } },
			{ key: 'vampireUpgradePoints', label: 'Vampire Upgrade Points (VUP)', type: 'number', default: 0, min: 0, showIf: { key: 'vampire', in: ['Yes'] } },
			...JOJO_GROWTH_FIELDS,
		],
		budget: {
			label: 'Stand Points',
			// A canon Stand keeps its canon stats instead.
			total: (f) => (hasStand(f) && !f.canonStand ? 15 : 0),
			spent: (f) => (hasStand(f) && !f.canonStand ? standStats.reduce((sum, stat) => sum + (standGrades.find((g) => g.value === f[standKey(stat)])?.points ?? 0), 0) : 0),
		},
		checks: (f) => {
			const out: { level: 'error' | 'warning' | 'permission'; message: string }[] = [];
			if (!hasStand(f) && !hasHamon(f) && !hasSpin(f) && !isVampire(f)) out.push({ level: 'error', message: 'JoJo: start with a Stand, or ask permission to start with Hamon, Spin or Vampirism.' });
			if (hasHamon(f) && isVampire(f)) out.push({ level: 'error', message: 'JoJo: Hamon and Vampirism can’t go together. Hamon is deadly to Vampires.' });
			if (f.ulf === 'Yes' && f.vampire !== 'Yes') out.push({ level: 'error', message: 'JoJo: only a Vampire can become the Ultimate Life Form.' });
			if (f.goldenSpin && !hasSpin(f)) out.push({ level: 'error', message: 'JoJo: Golden Spin needs Spin.' });
			if (f.standEvolution && !hasStand(f)) out.push({ level: 'error', message: 'JoJo: Stand Evolution needs a Stand.' });
			return out;
		},
	},
	{
		id: 'fire-force',
		label: 'Fire Force',
		universe: 'fire-force',
		claimLabel: 'Canon Ignition Ability',
		groups: [
			{ label: 'Pyrokinesis', keys: ['name', 'generation', 'theme'] },
			{ label: 'Levels', keys: ['manipulation', 'power', 'oxygenTank', 'efficiency', 'absorption'] },
			{ label: 'Stigma', keys: ['stigma', 'stigmaMark'] },
			{ label: 'Adolla Burst', keys: ['adollaBurst'] },
			{ label: 'Adolla Grace', keys: ['adollaEntity', 'fourthAbility'] },
			{ label: 'Techniques', keys: TECHNIQUE_KEYS },
			{ label: 'Tephrosis', keys: ['tephrosis'] },
			// Shown by their own trackers on the Techniques, Adolla and Tephrosis tabs.
			{ label: 'Technique log', keys: ['techniques', 'techniqueLog'] },
			{ label: 'Adolla Links', keys: ['adollaLinks'] },
			{ label: 'Tephrosis clock', keys: ['tephrosisSince'] },
		],
		fields: [
			nameField('Pyrokinesis name'),
			{
				key: 'generation',
				label: 'Generation',
				type: 'select',
				options: [{ value: 'Second' }, { value: 'Third' }, { value: 'XO', label: 'XO (Second and Third)', permission: true }],
				required: true,
			},
			{ key: 'theme', label: 'Theme', type: 'text', required: true, help: 'Every Pyrokinetic follows a theme and sticks to it.' },
			{ key: 'manipulation', label: 'Pyrokinetic Manipulation', type: 'select', options: levelOptions(MANIPULATION), default: '0', startsAt: 0, showIf: { key: 'generation', in: ['Second', 'XO'] } },
			{ key: 'power', label: 'Pyrokinetic Power', type: 'select', options: levelOptions(POWER), default: '0', showIf: { key: 'generation', in: ['Third', 'XO'] } },
			{ key: 'oxygenTank', label: 'Oxygen Tank', type: 'select', options: numberOptions(1, 10, (n) => `Lv ${n} — ${OXYGEN_TANK[n - 1]} OP${n === 1 ? ' (Start)' : ''}`), default: '1', showIf: { key: 'generation', in: ['Third', 'XO'] } },
			{ key: 'efficiency', label: 'Pyrokinetic Efficiency', type: 'select', options: numberOptions(0, 7, (n) => `Lv ${n} — ${EFFICIENCY[n][0]} Standard / ${EFFICIENCY[n][1]} Ult OP${n === 0 ? ' (Start)' : ''}`), default: '0', showIf: { key: 'generation', in: ['Third', 'XO'] } },
			{ key: 'absorption', label: 'Oxygen Absorption Rate', type: 'select', options: numberOptions(0, ABSORPTION_MAX, (n) => `Lv ${n} — +${absorptionRate(n)} OP / turn${n === 0 ? ' (Start)' : ''}`), default: '0', showIf: { key: 'generation', in: ['Third', 'XO'] } },
			...FIRE_FORCE_FIELDS,
			...FIRE_FORCE_LOG_FIELDS,
		],
		budget: {
			label: 'Fire Force Tier Points',
			total: (f) => (isThird(f) ? 8 : 0),
			spent: (f) => (isThird(f) ? num(f.power) + Math.max(0, num(f.oxygenTank) - 1) + num(f.efficiency) + num(f.absorption) : 0),
		},
		checks: (f) => {
			const out: { level: 'error' | 'warning' | 'permission'; message: string }[] = [];
			if (isThird(f) && num(f.power) > 15 && !hasBurst(f)) out.push({ level: 'error', message: 'Fire Force: Pyrokinetic Power past Level 15 needs an Adolla Burst.' });
			if (num(f.power) === 17 && !hasGrace(f)) out.push({ level: 'error', message: 'Fire Force: Pyrokinetic Power Z needs an Adolla Grace.' });
			if (isSecond(f) && num(f.manipulation) === 17 && !hasGrace(f)) out.push({ level: 'error', message: 'Fire Force: Pyrokinetic Manipulation Z needs an Adolla Grace.' });
			if (isSecond(f) && num(f.manipulation) === 16) out.push({ level: 'permission', message: 'Fire Force: Pyrokinetic Manipulation Y (Hybrid Power).' });
			if (f.adollaBurst === 'Yes' && !isThird(f)) out.push({ level: 'error', message: 'Fire Force: Adolla Bursts are only found in Third Generations.' });
			if (f.stigma === 'Yes' && hasBurst(f)) out.push({ level: 'warning', message: 'Fire Force: Burst holders see Adolla Links with no ill effects, so they don’t get a Stigma.' });
			techniqueLog(f).forEach((t) => {
				if (!String(t.teacher ?? '').trim()) out.push({ level: 'error', message: `Fire Force: say who taught you ${t.technique || 'each technique'}.` });
			});
			linkLog(f).forEach((l, i) => {
				if (!String(l.who ?? '').trim()) out.push({ level: 'error', message: `Fire Force: Adolla Link #${i + 1}: say who it was between.` });
			});
			return out;
		},
	},
	{
		id: 'infamous',
		label: 'inFAMOUS (Conduit)',
		universe: 'infamous',
		claimLabel: 'Canon Conduit',
		groups: [
			{ label: 'Conduit', keys: ['name', 'class', 'element'] },
			{ label: 'Levels', keys: ['power', 'drain', 'heal', 'tank', 'energyTank', 'chargeUpgrades', 'psychicPhase', 'bioShardNode', 'bioCoreNode', 'bioRelayNode'] },
			{ label: 'Evolution items', keys: ['blastShards', 'blastCores', 'coreRelays'] },
			{ label: 'Karma', keys: ['karma'] },
			{ label: 'Karma bar', keys: ['karmaPoints'] },
			{ label: 'Karma Bomb', keys: ['karmaBomb', 'karmicStreak'] },
			{ label: 'Mental Domination', keys: ['puppets'] },
		],
		fields: [
			nameField('Power name'),
			{ key: 'class', label: 'Conduit class', type: 'select', options: infamousClasses, required: true, help: 'Quantum can’t be picked.' },
			{ key: 'element', label: 'Element / Energy', type: 'text', showIf: { key: 'class', in: ['Elemental', 'Energy'] }, required: true },
			{ key: 'karma', label: 'Karma path', type: 'select', options: [{ value: 'Good', label: 'Good (Selflessness)' }, { value: 'Neutral', label: 'Not chosen yet' }, { value: 'Evil', label: 'Evil (Selfishness)' }], default: 'Neutral' },
			...CONDUIT_FIELDS,
		],
		budget: {
			label: 'Conduit Tier Points',
			total: (f) => infamousClasses.find((c) => c.value === f.class)?.points ?? 0,
			spent: ctpSpent,
		},
		checks: (f) => {
			const out: { level: 'error' | 'warning' | 'permission'; message: string }[] = [];
			const relays = num(f.coreRelays);
			if (num(f.karmicStreak) > 0 && relays < KARMA_BOMB_RELAYS) out.push({ level: 'error', message: `inFAMOUS: the Karmic Streak unlocks after ${KARMA_BOMB_RELAYS} Core Relays.` });
			if (num(f.karmicStreak) > 100) out.push({ level: 'error', message: 'inFAMOUS: the Karmic Streak holds 100 PK or NK.' });
			if (num(f.karmaPoints) > 0 && f.karma === 'Neutral') out.push({ level: 'warning', message: 'inFAMOUS: pick Good or Evil for your Karma path to rank up.' });
			return out;
		},
		defaultMoves: conduitMoves,
		ptpBonus: (f) => 10 + (f.class === 'Biologically Enhanced' ? 20 : 0),
	},
	{
		id: 'tokyo-ghoul',
		label: 'Tokyo Ghoul',
		universe: 'tokyo-ghoul',
		groups: [
			{ label: 'Path', keys: ['path', 'name'] },
			{ label: 'Kagune', keys: ['kagune', 'chimeraParents', 'kaguneRoll'] },
			{ label: 'Quinque', keys: ['quinque', 'quinqueFrom'] },
			{ label: 'Rc Tank', keys: ['gep', 'tankUpgrades', 'mutatedRc'] },
			{ label: 'Kakuja', keys: ['kakuja', 'kakujaForm'] },
			{ label: 'Special Rc', keys: ['specialRc'] },
			{ label: 'One-Eyed', keys: ['oneEyed', 'oneEyedHow'] },
			{ label: 'Quinx', keys: ['quinx', 'quinxFrames', 'rcTank'] },
		],
		fields: [
			nameField('Kagune or Quinque name'),
			{ key: 'path', label: 'Path', type: 'select', options: [{ value: 'Ghoul' }, { value: 'Human (Quinque user)', label: 'Human' }], required: true },
			{
				key: 'kagune',
				label: 'Kagune type (rolled)',
				type: 'select',
				options: KAGUNES.map((k) => ({ value: k.id, label: k.restricted ? `${k.id} (restricted)` : k.id, permission: k.restricted })),
				required: true,
			},
			{ key: 'chimeraParents', label: 'Your parents’ Kagune types', type: 'text', showIf: { key: 'kagune', in: ['Chimera'] }, required: true },
			{ key: 'kaguneRoll', label: 'Your Kagune roll', type: 'text', help: 'Link to your roll in the Rolling Channel. Restricted types can’t be rolled.' },
			{ key: 'quinque', label: 'Quinque', type: 'textarea', showIf: { key: 'path', in: ['Human (Quinque user)'] }, help: 'Only the CCG makes them, from the Kagunes of dead Ghouls.' },
			{ key: 'quinqueFrom', label: 'How you got it', type: 'select', options: [{ value: 'A CCG member' }, { value: 'Took it from a CCG member' }], showIf: { key: 'path', in: ['Human (Quinque user)'] } },
			{ key: 'gep', label: 'Ghoul Evolution Points earned (GEP)', type: 'number', default: 0, min: 0 },
			{ key: 'rcTank', label: 'Rc Tank', type: 'number', default: 0, min: 0, help: 'A Quinx’s tank grows as you eat: eat 500, a tank of 500.' },
			...GHOUL_GROWTH_FIELDS,
		],
		// A Kagune for Ghouls, One-Eyed Ghouls and Quinx; GEP upgrades for all but Quinx.
		hiddenKeys: (f) => [...(hasKagune(f) ? [] : ['kagune', 'chimeraParents', 'kaguneRoll']), ...(hasKagune(f) && !isQuinx(f) ? [] : ['gep', 'tankUpgrades', 'mutatedRc'])],
		onlyWith: (f) => (isGhoul(f) || isOneEyed(f) ? ['chainsaw-man'] : null),
		baseStats: (f) => (isGhoul(f) || isOneEyed(f) ? { rank: isOneEyed(f) ? '6B' : '4C', stats: ['strength', 'speed', 'defense', 'stamina'], noPtp: true } : null),
		checks: (f) => {
			const out: { level: 'error' | 'warning' | 'permission'; message: string }[] = [];
			if (isQuinx(f) && isGhoul(f)) out.push({ level: 'error', message: 'Tokyo Ghoul: a Quinx is a human with an implanted kakuhou, not a Ghoul.' });
			if (isQuinx(f) && isOneEyed(f)) out.push({ level: 'error', message: 'Tokyo Ghoul: pick One-Eyed or Quinx, not both.' });
			if (hasKagune(f) && !isQuinx(f) && gepSpent(f) > num(f.gep)) out.push({ level: 'error', message: `Tokyo Ghoul: ${gepSpent(f)} GEP spent on the Rc Tank, but only ${num(f.gep)} GEP earned.` });
			const stage = KAKUJA.find((k) => k.id === f.kakuja);
			if (stage && num(f.mutatedRc) < stage.mrc) out.push({ level: 'error', message: `Tokyo Ghoul: ${stage.id} needs ${stage.mrc} M-Rc (you have ${num(f.mutatedRc)}).` });
			return out;
		},
		notes: ['Ghouls can only pair with Chainsaw Man, and only by making contracts with Devils.'],
	},
	{
		id: 'chainsaw-man',
		label: 'Chainsaw Man',
		universe: 'chainsaw-man',
		groups: [
			{ label: 'Path & nature', keys: ['name', 'path', 'devilClass', 'concept'] },
			{ label: 'Blood & power', keys: ['bloodTank', 'dap'] },
			{ label: 'Contracts', keys: ['contracts'] },
			{ label: 'Fear Points', keys: ['fearPoints', 'tankUpgrades', 'tankBonus', 'regenUpgrades'] },
		],
		fields: [
			nameField('Name'),
			{ key: 'path', label: 'Path', type: 'select', options: [{ value: 'Devil' }, { value: 'Fiend' }, { value: 'Hybrid' }, { value: 'Human with contracts' }], required: true },
			{
				key: 'devilClass',
				label: 'Devil class',
				type: 'select',
				options: [{ value: 'Mundane' }, { value: 'Rational' }, { value: 'Irrational' }, { value: 'Primal' }],
				showIf: { key: 'path', in: ['Devil', 'Fiend', 'Hybrid'] },
				required: true,
			},
			{ key: 'concept', label: 'Feared concept', type: 'text', showIf: { key: 'path', in: ['Devil', 'Fiend', 'Hybrid'] }, required: true },
			// Worked out from the class, path and upgrades (devils.ts); kept on the card for reviewers.
			{ key: 'bloodTank', label: 'Blood Tank (BP)', type: 'number', min: 0, showIf: { key: 'path', in: ['Devil', 'Fiend', 'Hybrid'] } },
			{ key: 'dap', label: 'Devil Ability Power (DAP)', type: 'number', min: 0, showIf: { key: 'path', in: ['Devil', 'Fiend', 'Hybrid'] } },
			// Earned in RP after approval and spent on the Blood Tank and Regeneration.
			{ key: 'fearPoints', label: 'Fear Points earned (FP)', type: 'number', default: 0, min: 0, showIf: { key: 'path', in: ['Devil'] } },
			{ key: 'tankUpgrades', label: 'Blood Tank upgrades', type: 'number', default: 0, min: 0, showIf: { key: 'path', in: ['Devil'] } },
			{ key: 'tankBonus', label: 'Blood Tank upgrades past the max', type: 'number', default: 0, min: 0, showIf: { key: 'path', in: ['Devil'] } },
			{ key: 'regenUpgrades', label: 'Regeneration upgrades', type: 'number', default: 0, min: 0, showIf: { key: 'path', in: ['Devil'] } },
			{
				key: 'contracts',
				label: 'Contracts',
				type: 'list',
				showIf: { key: 'path', in: ['Human with contracts', 'Hybrid'] },
				columns: [
					{ key: 'devil', label: 'Devil', type: 'text', required: true },
					{
						key: 'type',
						label: 'Type',
						type: 'select',
						options: [{ value: 'Summoning' }, { value: 'Supernatural Object' }, { value: 'Hybrid' }, { value: 'Devil Transformation' }],
						required: true,
					},
					{ key: 'price', label: 'Price', type: 'text', required: true },
					{ key: 'grants', label: 'What the human can do', type: 'text', required: true },
					{ key: 'punishment', label: 'Punishment for breaking it', type: 'text', required: true },
				],
			},
		],
		checks: (f) => {
			const out: { level: 'error' | 'warning' | 'permission'; message: string }[] = [];
			if (f.path === 'Devil' && fearSpent(f) > num(f.fearPoints))
				out.push({ level: 'error', message: `Chainsaw Man: ${fearSpent(f)} FP spent on upgrades, but only ${num(f.fearPoints)} FP earned.` });
			if (num(f.tankBonus) > 0 && tankLevel(f) < TANK_MAX) out.push({ level: 'error', message: 'Chainsaw Man: max the Blood Tank before upgrading past it.' });
			return out;
		},
		notes: ['A contract missing its price, what it grants, or its punishment isn’t a contract.'],
	},
	{
		id: 'cyberpunk',
		label: 'Cyberpunk 2077',
		universe: 'cyberpunk-2077',
		groups: [
			{ label: 'Start & progress', keys: ['name', 'start', 'streetCred', 'xp', 'skillPoints'] },
			{ label: 'Cyberware', keys: ['cyberware'] },
		],
		fields: [
			nameField('Build name'),
			{ key: 'start', label: 'Start', type: 'select', options: [{ value: 'Powered' }, { value: 'Unpowered' }], required: true, help: 'Unpowered starts unlock the Mastery System.' },
			{ key: 'streetCred', label: 'Street Cred', type: 'number', default: 0, min: 0 },
			{ key: 'xp', label: 'XP (out of 100)', type: 'number', default: 0, min: 0, showIf: { key: 'start', in: ['Unpowered'] } },
			{ key: 'skillPoints', label: 'Skill Points', type: 'number', default: 0, min: 0, showIf: { key: 'start', in: ['Unpowered'] } },
			{
				key: 'cyberware',
				label: 'Cyberware',
				type: 'list',
				help: 'Cyberware is obtained in RP. It opens once your character is approved.',
				columns: [
					{
						key: 'name',
						label: 'Cyberware',
						type: 'select',
						options: [
							...cyberItems.map((i) => ({ value: i.name, group: i.slot })),
							{ value: OTHER_CYBERWARE, group: 'Other' },
						],
						required: true,
						derive: (name): Record<string, string> => (cyberSlotOf.has(name) ? { slot: cyberSlotOf.get(name)! } : {}),
					},
					{ key: 'custom', label: 'Name (if Other)', type: 'text' },
					{ key: 'slot', label: 'Slot', type: 'select', options: cyber.slots.map((x) => ({ value: x.id, label: `${x.id} (${x.count})` })), required: true },
					{ key: 'grade', label: 'Grade', type: 'select', options: cyber.grades.map((g) => ({ value: g })), required: true, default: 'Civilian' },
					{ key: 'tier', label: 'Tier', type: 'select', options: cyber.tiers.map((t) => ({ value: String(t.tier), label: `Tier ${t.tier} (level ${t.level}+)` })), required: true, default: '1' },
				],
			},
		],
		checks: (f, starting) => {
			const out: { level: 'error' | 'warning' | 'permission'; message: string }[] = [];
			const items = (Array.isArray(f.cyberware) ? f.cyberware : []) as Record<string, string>[];
			for (const slot of slotsOf(f)) {
				const used = items.filter((i) => i.slot === slot.id).length;
				const total = slotTotal(slot);
				if (used > total) out.push({ level: 'error', message: `Cyberware: ${used} pieces in ${slot.id}, but it has ${total} slot${total === 1 ? '' : 's'}.` });
				if (slot.extra) out.push({ level: 'permission', message: `Cyberware: ${slot.extra} extra ${slot.id} slot${slot.extra === 1 ? '' : 's'} from the Skill Tree.` });
			}
			for (const x of extraSlotsOf(f)) if (!slotsOf(f).some((s) => s.id === x && s.upgradeable)) out.push({ level: 'error', message: `Cyberware: ${x} slots can’t be upgraded.` });
			items.forEach((i, n) => {
				const other = i.name === OTHER_CYBERWARE;
				const label = (other ? i.custom : i.name) || `#${n + 1}`;
				const home = cyberSlotOf.get(i.name);
				if (home && i.slot && i.slot !== home) out.push({ level: 'error', message: `Cyberware: ${label} goes in ${home}, not ${i.slot}.` });
				if (other && !i.custom?.trim()) out.push({ level: 'error', message: `Cyberware #${n + 1}: write the name of the Other cyberware.` });
				if (other) out.push({ level: 'permission', message: `Cyberware: ${label} isn’t on the cyberware list.` });
				if (i.grade === 'Modified') out.push({ level: 'permission', message: `Cyberware: ${label} is Modified (scavenged or made; making it needs Genius Intelligence).` });
			});
			return out;
		},
	},
];

const grades = (names: string[]): Option[] => names.map((value) => ({ value }));
const DOMAIN_GRADES = ['Grade 4', 'Semi-Grade 3', 'Grade 3', 'Semi-Grade 2', 'Grade 2', 'Semi-Grade 1', 'Grade 1'];

// Permission Based starts, from each system's Index pages. Each becomes a pick on the card that
// staff approve, plus the fields it needs. (Cursed Spirits have their own submission, Vessels are a
// trait, Reverse Cursed Energy and Black Flash aren't allowed at the start, and Oculars have their own
// tab, since their spots are counted.)
const EXTRAS: Record<string, Extra[]> = {
	'jujutsu-kaisen': [
		{
			label: 'Cursed Energy Property',
			page: 'jujutsu-kaisen/cursed-energy/cursed-energy-basics/',
			about: 'A rare few have Cursed Energy with a special property, like an Electric Property, that bypasses all Cursed Energy Defense. Your Cursed Technique must depend entirely on something you can’t easily access, and even then it’s a chance decided on submission.',
			fields: [{ key: 'ceProperty', label: 'Property', type: 'text', required: true, help: 'e.g. Electric' }],
		},
	],
};

// Ocular Jujutsu Organs have their own tab on the JJK card: a spot on the claim board (claim_type
// 'ocular'), and the eye itself.
export const OCULAR_GROUP = 'Ocular';
const OCULAR_FIELDS: Field[] = [
	{ key: 'ocular', label: 'Ocular name', type: 'text', help: 'e.g. Six Eyes' },
	{ key: 'ocularImage', label: 'Picture of the eye', type: 'text' },
	{ key: 'ocularAbility', label: 'What it does', type: 'textarea', help: 'Its unique ability, and whether it can be turned off.' },
];
export const OCULAR_KEYS = OCULAR_FIELDS.map((f) => f.key);
{
	const jjk = systems.find((d) => d.id === 'jujutsu-kaisen')!;
	jjk.fields.push(...OCULAR_FIELDS);
	(jjk.groups ??= []).push({ label: OCULAR_GROUP, keys: OCULAR_KEYS });
}
/** Old cards asked for an Ocular as a Permission Based start: its details move to the Oculars tab. */
export function ocularFromOld(fields: Fields): Fields {
	const picks = Array.isArray(fields.extras) ? (fields.extras as string[]) : null;
	if (!picks?.includes('Ocular Jujutsu Organ') && fields.OcularJujutsuOrganDetails === undefined) return fields;
	const { OcularJujutsuOrganDetails: details, ...rest } = fields;
	return {
		...rest,
		...(picks ? { extras: picks.filter((x) => x !== 'Ocular Jujutsu Organ') } : {}),
		...(details && !rest.ocularAbility ? { ocularAbility: details } : {}),
	};
}

// Barrier Techniques have their own tab on the JJK card, locked for a new character (see barrierUnlocked).
export const BARRIER_GROUP = 'Barrier Techniques';
/**
 * The Barrier Techniques a card can list (Index: Barrier Techniques): their cost, the barrier stats
 * that belong to each, and a set description for those that are the same for everyone (Curtains).
 * Commissioned Curtains are items from the Black Market, so they aren't here.
 */
export const BARRIER_KINDS: { name: string; group: string; cost?: string; stats?: string[]; about?: string; once?: boolean }[] = [
	{
		name: 'Curtain',
		group: 'Curtains',
		cost: '10 CEP · 10 turns or until broken',
		once: true,
		about: 'A simple barrier that hides everything inside from non-sorcerers, traps enemies inside and goes pitch dark to lure out curses. Cast with a hand sign and the chant: “Emerge from the darkness, blacker than darkness. Purify that which is impure.”',
	},
	{ name: 'Incomplete Domain', group: 'Domain Expansion', cost: '145 CEP · 10 CEP / turn', stats: ['domainGrade'] },
	{ name: 'Complete Domain', group: 'Domain Expansion', cost: '520 CEP · 20 CEP / turn', stats: ['domainGrade', 'constructionSpeed'] },
	{ name: 'Simple Domain', group: 'Anti-Barrier', cost: '34 CEP · 3 CEP / turn', stats: ['simpleDomainGrade'] },
	{
		name: 'Hollow Wicker Basket',
		group: 'Anti-Barrier',
		cost: '55 CEP · 7 CEP / turn',
		once: true,
		about: 'The ancient predecessor of Simple Domain. Interlock your fingers and extend your arms to make a woven-basket barrier that nullifies Sure Hit. Cheap to maintain, and you can move while holding the hand sign.',
	},
	{
		name: 'Domain Amplification',
		group: 'Anti-Barrier',
		cost: '260 CEP · 25 CEP / turn',
		stats: ['amplificationGrade'],
		once: true,
		about: 'Wrap yourself in an empty Domain that sucks in and neutralizes any Cursed Technique it touches, including a Domain’s Sure Hit. Your own Cursed Technique is off while it’s active, so you fight with your fists or other abilities.',
	},
	{
		name: 'Falling Blossom Emotion',
		group: 'Anti-Barrier',
		cost: '20 CEP per deflect',
		once: true,
		about: 'Family exclusive. A Cursed Energy shroud that counterattacks the moment a Sure Hit touches it. Also a sword technique: coat your blade, and anything the Cursed Energy touches takes a devastating blow.',
	},
	{
		name: 'All or Nothing Domain Expansion',
		group: 'Specialized',
		cost: '173 CEP',
		stats: ['domainGrade'],
		once: true,
		about: 'A Domain that expands, hits and vanishes in 0.2 seconds, cast in the heat of the moment. Anti-Barrier Techniques can’t counter it unless they’re already up, and it causes no CT burnout.',
	},
	{
		name: 'Open Domain',
		group: 'Specialized',
		once: true,
		about: 'A Domain with no barrier to construct. A Binding Vow leaves an escape route, and in exchange its range becomes Open Domain Range: the entire category. Against a closed Domain, an Open Domain’s physical attack can hit it from outside and destroy it.',
	},
	{
		name: 'Size Alteration',
		group: 'Specialized',
		once: true,
		about: 'Shrinks your Domain’s outer barrier while the inside stays huge. Its use is against Open Domains: their attacks can’t hit a tiny shell, so your Domain won’t shatter mid-clash. It doesn’t protect against external Domains.',
	},
	{ name: 'Domain Burst', group: 'Specialized', cost: '189 CEP' },
];
const BARRIER_FIELDS: Field[] = [
	{
		key: 'barrierTechniques',
		label: 'Barrier Techniques known',
		type: 'list',
		columns: [
			{ key: 'kind', label: 'Technique', type: 'select', options: BARRIER_KINDS.map((k) => ({ value: k.name, group: k.group })) },
			{ key: 'name', label: 'Name', type: 'text' },
			{ key: 'notes', label: 'How it works', type: 'text' },
		],
	},
	{ key: 'domainGrade', label: 'Domain Grade', type: 'select', options: levels([...DOMAIN_GRADES, 'Special Grade 1', 'Special Grade']), default: 'Grade 4', startsAt: ['Grade 4'] },
	{ key: 'constructionSpeed', label: 'Construction Speed', type: 'select', options: levels(['0 (5 turns)', '1 (4 turns)', '2 (3 turns)', '3 (2 turns)', '4 (1 turn)', 'Non-Lethal (instant)']), default: '0 (5 turns)', startsAt: ['0 (5 turns)'] },
	{ key: 'simpleDomainGrade', label: 'Simple Domain Grade', type: 'select', options: levels(DOMAIN_GRADES), default: 'Grade 4', startsAt: ['Grade 4'] },
	{ key: 'amplificationGrade', label: 'Domain Amplification Grade', type: 'select', options: levels(DOMAIN_GRADES), default: 'Grade 4', startsAt: ['Grade 4'] },
	{ key: 'btUpgradePoints', label: 'Barrier Technique Upgrade Points (BTUP)', type: 'number', default: 0, min: 0, startsAt: 0 },
];
export const BARRIER_KEYS = BARRIER_FIELDS.map((f) => f.key);
/** A barrier field that holds something: a list with entries, or a value off its default. */
export const barrierUsed = (x: Field, v: FieldValue | undefined) => (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== '' && v !== x.default);
/** Old cards wrote their Barrier Techniques in one box: it becomes one entry, for the player to pick its technique. */
export function barriersFromOld(fields: Fields): Fields {
	const v = fields.barrierTechniques;
	if (v === undefined || Array.isArray(v)) return fields;
	const text = String(v).trim();
	return { ...fields, barrierTechniques: text ? [{ kind: '', name: '', notes: text }] : [] };
}
{
	const jjk = systems.find((d) => d.id === 'jujutsu-kaisen')!;
	jjk.fields.push(...BARRIER_FIELDS);
	(jjk.groups ??= []).push({ label: BARRIER_GROUP, keys: BARRIER_KEYS });
}

/**
 * How a JJK card's Barrier Techniques are unlocked, or null while locked. A new character needs the
 * Barrier Prodigy trait, a family ability that includes them, or values staff set; after approval
 * (or when staff mark the character as already progressed) they're learned with BTUP as normal.
 */
export function barrierUnlocked(
	sheet: { traits: { name: string }[] },
	entry: { key: string; fields: Fields; familyLink?: unknown },
	ctx: { isEvolution?: boolean; staffOverrides?: Record<string, unknown> },
): string | null {
	if (ctx.isEvolution) return 'Learned with BTUP.';
	if (sheet.traits.some((t) => t.name === 'Barrier Prodigy')) return 'Unlocked by your Barrier Prodigy trait.';
	if (entry.familyLink && barrierUsed(BARRIER_FIELDS[0], barriersFromOld(entry.fields).barrierTechniques)) return 'Unlocked by your family ability.';
	if (BARRIER_KEYS.some((k) => ctx.staffOverrides?.[`card:${entry.key}.${k}`])) return 'Unlocked by staff.';
	return null;
}

for (const def of systems) {
	const extras = EXTRAS[def.id];
	if (!extras) continue;
	def.extras = extras;
	def.fields.push({
		key: EXTRAS_KEY,
		label: 'Permission Based starts',
		type: 'multiselect',
		options: extras.map((x) => ({ value: x.label, permission: true })),
		help: 'Only with staff permission. Each one you pick is sent to staff to approve.',
	});
	const groups = (def.groups ??= []);
	groups.push({ label: EXTRAS_GROUP, keys: [EXTRAS_KEY] });
	for (const x of extras) {
		const details: Field = { key: `${x.label.replace(/\W/g, '')}Details`, label: 'Details', type: 'textarea', help: 'How your character has it.' };
		const fields = [...(x.fields ?? []), details].map((f) => ({ ...f, showIf: { key: EXTRAS_KEY, in: [x.label] } }));
		def.fields.push(...fields);
		groups.push({ label: x.label, keys: fields.map((f) => f.key) });
	}
}

export const systemById = new Map(systems.map((s) => [s.id, s]));

/** Whether a showIf condition holds; a multiselect matches when any of its picks is listed. */
const shownBy = (cond: { in: string[] }, value: FieldValue | undefined) =>
	Array.isArray(value) ? value.some((v) => typeof v === 'string' && cond.in.includes(v)) : cond.in.includes(String(value ?? ''));

export const visibleFields = (def: SystemDef, f: Fields) => {
	const hidden = def.hiddenKeys?.(f) ?? [];
	return def.fields.filter((field) => !hidden.includes(field.key) && (!field.showIf || shownBy(field.showIf, f[field.showIf.key])));
};

/** Which system a family ability's card is for; perks from before other systems were allowed are Abilities. */
export const abilitySystem = (a: { system?: string }) => a.system ?? 'abilities';

/** Rolled fields a family ability leaves empty, so each member rolls them on their own card. */
export function openRolledKeys(def: SystemDef | undefined, familyFields: Fields): string[] {
	const rolled = def?.fields.filter((f) => f.rolled) ?? [];
	const set = (v: FieldValue | undefined) => v !== undefined && v !== '' && v !== 0;
	if (!rolled.length || rolled.some((f) => set(familyFields[f.key]))) return [];
	return [...rolled.map((f) => f.key), 'ceLevel'];
}

/** What a Family ability sets on a member's card: field keys (null = all) and whether the skills. */
export function familyScope(def: SystemDef | undefined, ability: { parts?: string[] }) {
	if (!def?.familyParts || !ability.parts) return { keys: null as Set<string> | null, skills: true };
	const parts = def.familyParts.filter((p) => ability.parts!.includes(p.label));
	const groups = new Set(parts.flatMap((p) => p.groups));
	return {
		keys: new Set(def.groups?.filter((g) => groups.has(g.label)).flatMap((g) => g.keys) ?? []),
		skills: parts.some((p) => p.skills),
	};
}

/** Field keys a member fills in on a linked card: parts the family left out, and rolls it left open. */
export function memberKeys(def: SystemDef | undefined, ability: { parts?: string[]; fields: Fields }) {
	const { keys } = familyScope(def, ability);
	const open = openRolledKeys(def, ability.fields);
	const own = keys ? (def?.fields.map((f) => f.key) ?? []).filter((k) => !keys.has(k)) : [];
	// ceLevel comes with the Cursed Energy roll.
	if (own.some((k) => def?.fields.find((f) => f.key === k)?.rolled)) own.push('ceLevel');
	return [...new Set([...own, ...open])];
}

/** A card's visible fields, split into its sections. */
export function groupedFields(def: SystemDef, f: Fields) {
	const shown = visibleFields(def, f);
	const listed = new Set(def.groups?.flatMap((g) => g.keys));
	const out = (def.groups ?? []).map((g) => ({ label: g.label, fields: shown.filter((x) => g.keys.includes(x.key)) }));
	const rest = shown.filter((x) => !listed.has(x.key));
	if (rest.length) out.push({ label: def.groups ? 'Other' : 'Details', fields: rest });
	return out.filter((g) => g.fields.length);
}

/** Whether a card counts toward its system's one-per-character limit. */
export const countsTowardLimit = (def: SystemDef | undefined, f: Fields) =>
	!def?.limitedChoice || f[def.limitedChoice.key] === def.limitedChoice.value;

/** Whether a value is past where a new character starts. */
export const pastStart = (field: Field, value: unknown) => {
	const start = field.startsAt;
	if (start === undefined || value === undefined || value === '') return false;
	return typeof start === 'number' ? (Number(value) || 0) > start : !start.includes(String(value));
};

/** "Physical or Close", "0" */
export const startText = (field: Field) => (typeof field.startsAt === 'number' ? String(field.startsAt) : (field.startsAt ?? []).join(' or '));
