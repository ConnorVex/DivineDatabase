// What a power system can grow into: evolutions a new character starts without (a Quirk's
// Awakenings and Variant, and later every other system's). Each shows on the card as a locked tab
// with its requirements and the character's progress toward them. It opens once the character has
// it, staff unlock it, or (after approval) the requirements a sheet can show are met; staff confirm
// the rest when they review the evolution. Rules and numbers come from the Index.
import rulesData from '../../data/portal/rules.json' with { type: 'json' };
import { QUIRK_VARIANTS, type Fields } from './systems.ts';
import { TEPHROSIS, hasBurst, hasGrace, isThird } from './fireforce.ts';
import { AFFINITY_TRAIT, KAKUJA, hasKagune, isGhoul, isOneEyed, isQuinx } from './ghouls.ts';
import { KARMA_BOMB_RELAYS } from './conduits.ts';
import { ENLIGHTENMENT, SPIN_TRAIT, STAND_AWAKENING, STAND_PRODIGY, hasHamon, hasSpin, hasStand, isUltimate, isVampire } from './jojo.ts';

/** The Combo trait a character starts as a One-Eyed Ghoul with (Tokyo Ghoul: One-Eyed and Quinx). */
export const ONE_EYED_COMBO = 'One Eyed Ghoul';

/** met/unmet are read from the sheet; 'staff' is something staff confirm (an event, a roll). */
export type RequirementStatus = 'met' | 'unmet' | 'staff';

export interface Requirement {
	label: string;
	status: RequirementStatus;
	/** e.g. [40, 90] for "40 / 90 QUP". */
	progress?: [number, number];
	/** Where the character is now, e.g. "You have Average". */
	detail?: string;
	/** Unmet, it blocks even a permitted start (e.g. Hamon on a Vampire). */
	blocksStart?: boolean;
	/** Met, a new character can start with it without asking staff (a trait or Combo trait); the reason shown. */
	grantsStart?: string;
	/** Only checked for a new character (e.g. the trait needed to start with Spin, which anyone can learn later). */
	startOnly?: boolean;
}

export interface PotentialCtx {
	/** The character's Potential grade id (rules.json potentials). */
	potential: string;
	traits: string[];
	/** Combo traits the database found for the character (names only). */
	combos?: string[];
	/** How many cards of each system the character has (e.g. Underclocking needs a second ability). */
	systemCounts?: Record<string, number>;
}

export interface PotentialDef {
	id: string;
	label: string;
	/** What it is, from the Index. */
	about: string;
	/** The card's field group shown once it's open. */
	group: string;
	/** The card fields that hold it: changing them needs it open. */
	keys: string[];
	/** The character already has it (e.g. at least one Awakening). */
	reached: (f: Fields) => boolean;
	/** What's needed for the next one. */
	requirements: (f: Fields, ctx: PotentialCtx) => Requirement[];
	/** What it gives, for the character's current state. */
	perks: (f: Fields) => string[];
	/** Shown to staff when it changes in an evolution. */
	confirm: string;
	/** Heading over the perks when "What you get" doesn't fit (e.g. Tephrosis). */
	perksLabel?: string;
	/** A new character can start with it if staff permit it (a permission item, not a lock). */
	startPermission?: boolean;
	/** For ones that happen again (Awakenings): the count field; each new one needs the requirements again. */
	count?: string;
	/** How many of `count` came from rolls on the tab (e.g. Spontaneous Evolution): those skip the requirements. */
	rolledCount?: string;
}

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);
const potentialRank = (id: string) => rulesData.potentials.findIndex((p) => p.id === id);
const potentialLabel = (id: string) => rulesData.potentials.find((p) => p.id === id)?.label;

const stored = (f: Fields, need: number, code: string, label = `${need} ${code} stored`): Requirement => {
	const have = num(f.upgradePoints);
	return { label, status: have >= need ? 'met' : 'unmet', progress: [have, need] };
};
const blankText = (v: unknown) => String(v ?? '').trim() === '';

// My Hero Academia: Quirk Evolution and Quirk Variants.
const VARIANT_PERKS: Record<string, string[]> = {
	Plus: ['Quirk Power up to Plus Variant: 70 (12F) / 74 (12A)', '+3 QUP per session', 'Recoil reduced', 'Skills cost 3 QUP less'],
	Maximum: ['Quirk Power up to Maximum Variant: 76 (13F) / 80 (13A)', '+6 QUP per session', 'Recoil greatly reduced or removed', 'Skills cost 5 QUP less', '1 capability no Awakening could give'],
	Infinite: ['Quirk Power up to Infinite Variant: 81 (14+)', '+9 QUP per session', 'Recoil removed', 'Skills cost 8 QUP less', 'Up to 4 capabilities no Awakening could give'],
};

const hasVariant = (f: Fields) => (QUIRK_VARIANTS as readonly string[]).includes(String(f.variant ?? ''));

const quirk: PotentialDef[] = [
	{
		id: 'awakening',
		label: 'Awakening',
		about: 'A rare evolution that gives you a deeper understanding of your Quirk. It can happen several times, until your Quirk is maxed out.',
		group: 'Quirk Awakening',
		keys: ['awakenings', 'awakeningLog'],
		reached: (f) => num(f.awakenings) > 0,
		requirements: (f) => [
			stored(f, 90, 'QUP'),
			{ label: 'An event that helps you understand your Quirk, like a psychological push or a ritual', status: 'staff' },
		],
		perks: () => ['Each Awakening gives one: access to higher Quirk Power, or expanded Quirk rules'],
		confirm: 'staff confirm the Awakening event.',
		count: 'awakenings',
		rolledCount: 'rolledAwakenings',
	},
	{
		id: 'variant',
		label: 'Instability & Variant',
		about: 'Every so often a Quirk goes unstable for 3 RPs: Quirk Power becomes Unstable (64, 68) and Strength, Speed and Defense get +2 Sub-Tiers. On the last turn, a roll can evolve it into a Variant, far better than the original.',
		group: 'Quirk Variant',
		keys: ['variant', 'variantCapabilities'],
		reached: hasVariant,
		requirements: (f, ctx) => {
			const great = potentialRank('great');
			const rank = potentialRank(ctx.potential);
			const top = ctx.traits.includes('Quirk Prodigy') ? 'Great' : 'Average';
			const power = String(f.power ?? 'No Power');
			return [
				{ label: 'Great Potential or higher', status: rank >= great ? 'met' : 'unmet', detail: potentialLabel(ctx.potential) ? `You have ${potentialLabel(ctx.potential)}` : 'Roll your Potential first' },
				{ label: `Quirk Power maxed out (${top}${top === 'Great' ? ', with Quirk Prodigy' : ''})`, status: power === top ? 'met' : 'unmet', detail: `Yours is ${power}` },
				stored(f, 50, 'QUP'),
				{ label: 'Quirk used in training or combat 3+ times', status: 'staff' },
				{ label: 'Roll for Instability below (50.1% to go unstable), then roll for Spontaneous Evolution after 3 unstable RPs', status: 'staff' },
			];
		},
		perks: (f) => (hasVariant(f) ? VARIANT_PERKS[String(f.variant)] : ['Plus (most common), Maximum (rare) or Infinite (rarest): each raises Quirk Power, QUP gains and skill discounts']),
		confirm: 'staff check the Instability and Spontaneous Evolution rolls in the evolution log.',
	},
];

// Abilities: Ability Evolution (Metamorphosis, Ability Potential) and Overclocking and Underclocking.
/** Metamorphoses each Potential allows. */
const METAMORPHOSES: [string[], number][] = [
	[['limited', 'low'], 1],
	[['average'], 2],
	[['great', 'high', 'insane'], 4],
	[['immense', 'colossal'], 5],
	[['tremendous', 'peak', 'ultimate', 'apex', 'unparalleled', 'divine'], 10],
];
export const metamorphosisCap = (potential: string) => METAMORPHOSES.find(([ids]) => ids.includes(potential))?.[1] ?? 0;

const abilities: PotentialDef[] = [
	{
		id: 'metamorphosis',
		label: 'Metamorphosis',
		about: 'Like Quirks, abilities can evolve to tap deeper into their core. Pay AUP to start it, then go RPs without using your ability while it blooms into its new form. Each one costs 50 AUP more and takes 2 RPs longer than the last.',
		group: 'Metamorphosis',
		keys: ['metamorphoses', 'metamorphosisNotes'],
		count: 'metamorphoses',
		reached: (f) => num(f.metamorphoses) > 0,
		requirements: (f, ctx) => {
			const next = num(f.metamorphoses) + 1;
			const cap = metamorphosisCap(ctx.potential);
			return [
				{
					label: `Your Potential allows another (${cap} in all)`,
					status: next <= cap ? 'met' : 'unmet',
					detail: potentialLabel(ctx.potential) ? `${potentialLabel(ctx.potential)} Potential: ${Math.min(next - 1, cap)} of ${cap} used` : 'Roll your Potential first',
				},
				stored(f, 50 * next, 'AUP', `${50 * next} AUP to pay for the ${ordinal(next)}`),
				{ label: `Go ${1 + 2 * next} RPs without using your ability`, status: 'staff' },
			];
		},
		perks: () => ['Your ability blooms into a new form, tapping deeper into its core', 'Limited–Low Potential: 1 · Average: 2 · Great–Insane: 4 · Immense–Colossal: 5 · Tremendous+: 10'],
		confirm: 'staff confirm the AUP was paid and the RPs without the ability.',
	},
	{
		id: 'overclocking',
		label: 'Overclocking',
		about: 'Push your ability to its absolute limit in a tough spot: a massive power surge that can overwhelm unprepared opponents. It makes your ability unstable, and it can disappear forever.',
		group: 'Overclocking',
		keys: ['overclockSkills', 'overclockUpgrades'],
		reached: (f) => !blankText(f.overclockSkills),
		requirements: (f) => [stored(f, 100, 'AUP', '100 AUP to unlock')],
		perks: () => [
			'While overclocked: Ability Power becomes Overclocked (115), +3 Sub-Tiers to Strength, Speed and Defense, and 4 temporary skills (2 Standard, 2 Ultimate)',
			'Afterwards: Ability Power −3 levels for 3 turns, and −60 Stamina',
			'+10 Instability each turn overclocked, −5 each turn not using your ability. At 50+, roll 1d10 every turn; at 100 the ability is lost',
		],
		confirm: 'staff confirm the 100 AUP and the Overclocked skills.',
	},
	{
		id: 'underclocking',
		label: 'Underclocking',
		about: 'Lend power from this ability to another that suits the situation better. Made for users with more than one active ability.',
		group: 'Underclocking',
		keys: ['underclockLevel', 'underclockTarget'],
		reached: (f) => !blankText(f.underclockLevel),
		requirements: (f, ctx) => {
			const others = (ctx.systemCounts?.abilities ?? 1) - 1;
			return [
				stored(f, 150, 'AUP', '150 AUP to unlock'),
				{ label: 'Another ability to lend power to', status: others > 0 ? 'met' : 'unmet', detail: 'Add a second Abilities card' },
			];
		},
		perks: () => [
			'Move 5 Power (Level 1) up to 25 (Level 5) to one other ability, 1:1',
			'The donor must have that much Power to spare',
			'Lasts 5 turns, then a 10-turn cooldown. Can’t be combined with Overclocking either way',
		],
		confirm: 'staff confirm the 150 AUP.',
	},
];

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

// Fire Force: Adolla (Stigma, Burst, Grace) and Tephrosis.
const thirdGen = (f: Fields): Requirement => ({
	label: 'Third Generation (or XO)',
	status: isThird(f) ? 'met' : 'unmet',
	detail: 'Only Third Generations produce their own fire',
});
const fireForce: PotentialDef[] = [
	{
		id: 'stigma',
		label: 'Stigma',
		about: 'A Pyrokinetic without an Adolla Burst who experiences an Adolla Link is left permanently scarred, usually on the face or eyes.',
		group: 'Stigma',
		keys: ['stigma', 'stigmaMark'],
		reached: (f) => f.stigma === 'Yes',
		requirements: (f) => [
			{ label: 'No Adolla Burst', status: hasBurst(f) ? 'unmet' : 'met', detail: 'Burst holders see Links with no ill effects' },
			{ label: 'Experienced an Adolla Link in RP', status: 'staff' },
		],
		perks: () => ['No drawbacks', 'When a Link happens nearby, peer into it: roll 1d10, 5+ succeeds, 2 tries per Link'],
		confirm: 'staff confirm the Adolla Link.',
	},
	{
		id: 'burst',
		label: 'Adolla Burst',
		about: 'The Genesis Flame: unsullied fire from Adolla with immense power, found in a select few Third Generations. Most Burst holders are Pillars, who represent emotions.',
		group: 'Adolla Burst',
		keys: ['adollaBurst'],
		reached: hasBurst,
		requirements: (f) => [thirdGen(f), { label: 'Your Genesis Flame shows itself in RP', status: 'staff' }],
		perks: () => ['+5 TGUP per training session (stacks with grinding traits)', 'Pyrokinetic Power past Level 15, up to Y (Z with an Adolla Grace)', 'Adolla Links with no ill effects'],
		confirm: 'staff confirm the Adolla Burst.',
	},
	{
		id: 'grace',
		label: 'Adolla Grace',
		about: 'An Adolla Entity can grant its Grace to a Burst user through a Link. Burst plus Grace makes a Fourth Generation, which is extremely rare.',
		group: 'Adolla Grace',
		keys: ['adollaEntity', 'fourthAbility'],
		reached: hasGrace,
		requirements: (f) => [
			{ label: 'An Adolla Burst', status: hasBurst(f) ? 'met' : 'unmet' },
			{ label: 'An Adolla Entity grants it through a Link', status: 'staff' },
		],
		perks: () => ['Fourth Generation: a unique theme-based ability that breaks the laws of physics', 'Pyrokinetic Power Z (150+)', 'The Entity can revoke it at any time'],
		confirm: 'staff confirm the Entity and the Fourth Generation ability.',
	},
	{
		id: 'tephrosis',
		label: 'Tephrosis',
		about: 'The Ignition Limit: push past your oxygen and your body becomes the fuel. It won’t kill you, but it cripples you, and once it starts it lasts until you die.',
		group: 'Tephrosis',
		keys: ['tephrosis', 'tephrosisSince'],
		reached: (f) => !blankText(f.tephrosis),
		requirements: (f) => [thirdGen(f), { label: 'Your oxygen went into the negatives in RP', status: 'staff' }],
		perks: (f) => {
			const at = TEPHROSIS.findIndex((t) => t.id === f.tephrosis);
			return at < 0 ? TEPHROSIS.slice(0, 3).map((t) => `${t.id} (${t.badge}): ${t.effects[0]}`) : TEPHROSIS[at].effects;
		},
		confirm: 'staff confirm the Tephrosis stage.',
		perksLabel: 'What it does to you',
	},
];

// JoJo: Hamon, Spin and Vampirism are learned (or started with permission); Hamon and Vampirism can't go together.
const jojo: PotentialDef[] = [
	{
		id: 'hamon',
		label: 'Hamon',
		about: 'The Ripple: special breathing makes energy that works like the Sun. It slows aging and is deadly in combat. Learnable anywhere; only Outworlders can start with it.',
		group: 'Hamon',
		keys: ['hamon', 'hamonTeacher'],
		reached: hasHamon,
		requirements: (f) => [
			{ label: 'Not a Vampire', status: isVampire(f) ? 'unmet' : 'met', detail: 'Hamon is deadly to Vampires', blocksStart: true },
			{ label: 'Taught by a Hamon Master, or learned in RP', status: 'staff' },
		],
		perks: () => ['Hamon Gauge 0/200, Drain 50 HP a post, Charge Rate 50 HP a Breathing Post', 'Starter Hamon skills; the rest are taught or self-learned', '4 HUP each time you use Hamon in training or combat', 'Trade 10 HP for 5 Stamina'],
		confirm: 'staff confirm who taught it.',
		startPermission: true,
	},
	{
		id: 'spin',
		label: 'Spin',
		about: 'A supernatural phenomenon of near-perfect rotation. Only taught in the Outworld, but anyone can learn it.',
		group: 'Spin',
		keys: ['spin', 'spinTeacher'],
		reached: hasSpin,
		requirements: (_f, ctx) => [
			// Only the Spinning Soul trait starts with Spin (JoJo: Spin Basics); anyone can learn it in RP.
			ctx.traits.includes(SPIN_TRAIT)
				? { label: `The ${SPIN_TRAIT} trait`, status: 'met', detail: 'You can start with Spin', grantsStart: `Unlocked by your ${SPIN_TRAIT} trait.` }
				: { label: `The ${SPIN_TRAIT} trait (to start with it)`, status: 'unmet', detail: `only the ${SPIN_TRAIT} trait starts with Spin`, blocksStart: true, startOnly: true },
			{ label: 'Taught by a Spin Master in the Outworld', status: 'staff' },
		],
		perks: () => ['Spin Gauge 0/100: +25 per charge post, −25 per post', 'Imbuement, Damage Enhancement, Projectile Control, Golden Skin and Limb Flattening', '2 SUP each time you use Spin (traits don’t raise it)'],
		confirm: 'staff confirm who taught it.',
		startPermission: true,
	},
	{
		id: 'goldenSpin',
		label: 'Golden & Cavalry Spin',
		about: 'Golden Spin draws infinite energy from the Golden Rectangle. Cavalry Spin adds your horse’s Golden Spin, and while it’s active you develop a Stand or your Stand is upgraded.',
		group: 'Golden & Cavalry Spin',
		keys: ['goldenSpin', 'enlightenment'],
		reached: (f) => !blankText(f.goldenSpin),
		requirements: (f) => [
			{ label: 'Spin', status: hasSpin(f) ? 'met' : 'unmet' },
			{ label: 'Golden Spin: a Spin Master teaches it', status: 'staff' },
			{ label: `Cavalry Spin: ${ENLIGHTENMENT} Enlightenment, Golden Spin and every Spin skill mastered`, status: 'staff', progress: [num(f.enlightenment), ENLIGHTENMENT] },
		],
		perks: (f) =>
			f.goldenSpin === 'Golden and Cavalry Spin'
				? ['Golden Spin: double damage, and Spin moves don’t drain the gauge', 'Cavalry Spin: a Stand of infinite rotation that bypasses dimensional barriers and Stand Time Stops']
				: ['Spin moves deal double damage and don’t drain your gauge', 'No Golden Rectangle (somewhere devoid of life), no Golden Spin', `Cavalry Spin: +2 Enlightenment each time you use Spin riding a healthy horse, up to ${ENLIGHTENMENT}`],
		confirm: 'staff confirm the teacher (Golden) or the Enlightenment (Cavalry).',
	},
	{
		id: 'vampire',
		label: 'Vampire',
		about: 'Turned undead by a Stone Mask. A race: once you become a Vampire, there’s no turning back.',
		group: 'Vampire',
		keys: ['vampire', 'stoneMask'],
		reached: (f) => f.vampire === 'Yes',
		requirements: (f) => [
			{ label: 'Not a Hamon user', status: hasHamon(f) ? 'unmet' : 'met', detail: 'a Vampire can’t use Hamon, and Hamon is deadly to them', blocksStart: true },
			{ label: 'Turned by a Stone Mask in RP', status: 'staff' },
		],
		perks: () => ['Enhanced Capabilities: +3 Primary and +3 Sub-Tiers to every stat but Intelligence', 'Blood Gauge up to 100 BP; Blood Suck, Regeneration and Wall Crawling', 'Semi-immortal, but sunlight and Hamon are deadly', '4 VUP per session using your vampiric abilities'],
		confirm: 'staff confirm how you were turned.',
		startPermission: true,
	},
	{
		id: 'ulf',
		label: 'Ultimate Life Form',
		about: 'The final stage of Vampire evolution. The power is intoxicating and takes the strongest will to control.',
		group: 'Ultimate Life Form',
		keys: ['ulf'],
		reached: isUltimate,
		requirements: (f) => [
			{ label: 'A Vampire', status: f.vampire === 'Yes' ? 'met' : 'unmet', detail: 'only Vampires can reach it', blocksStart: true },
			{ label: 'Maxed physical stats, Vampire abilities and Stand (if you have one)', status: 'staff' },
			{ label: 'A Stone Mask (Variant) with the Red Stone of Aja, at sunrise', status: 'staff' },
		],
		perks: () => ['All stats become 20A; Super Genius Intelligence; Unparalleled Potential', 'Biology Manipulation, Reactive Evolution, Hyper Regeneration', 'Immune to the sun; no need to eat, sleep or breathe', 'Ultimate Hamon: every Hamon skill at 155 Power, no breathing needed'],
		confirm: 'staff confirm the Stone Mask, the Red Stone and the sunrise.',
		startPermission: true,
	},
	{
		id: 'esoteric',
		label: 'Esoteric Ability',
		about: 'Every Stand has a wild ability, unique or shared, that reflects your soul: from making fire, to reverting entropy, to controlling time. Useful in combat and everyday life. It’s engraved in your Stand and awakens with Stand Awakening.',
		group: 'Esoteric Ability',
		keys: ['esotericName', 'esotericAbility'],
		reached: (f) => !blankText(f.esotericAbility),
		requirements: (f, ctx) => [
			{ label: 'A Stand', status: hasStand(f) ? 'met' : 'unmet', blocksStart: true },
			ctx.traits.includes(STAND_PRODIGY)
				? { label: `The ${STAND_PRODIGY} trait`, status: 'met', detail: 'Your ability is awake from the start', grantsStart: `Unlocked by your ${STAND_PRODIGY} trait.` }
				: { label: 'Stand Awakening', status: num(f.standAwakening) >= STAND_AWAKENING ? 'met' : 'unmet', progress: [Math.min(num(f.standAwakening), STAND_AWAKENING), STAND_AWAKENING], detail: 'A full gauge awakens your engraved ability' },
		],
		perks: () => ['Your Stand’s unique ability, in your own words', 'Stand Awakening also gives +4 points to every stat except Dev. Potential'],
		confirm: 'staff confirm the Esoteric Ability.',
	},
	{
		id: 'standEvolution',
		label: 'Stand Evolution',
		about: 'Evolved: pierced by a Stand Arrow a second time. Requiem: pierced by a Requiem Arrow with a clear goal. ACT: a Stand that metamorphoses as you mature (Low Potential only).',
		group: 'Stand Evolution',
		keys: ['standEvolution', 'standEvolutionNotes'],
		reached: (f) => !blankText(f.standEvolution),
		requirements: (f, ctx) => [
			{ label: 'A Stand', status: hasStand(f) ? 'met' : 'unmet' },
			{ label: 'Evolved: an awakened ability, and a second Arrow finds you worthy', status: 'staff', progress: [num(f.standAwakening), STAND_AWAKENING] },
			{ label: 'Requiem: a Requiem Arrow, said to appear once the doors to Heaven open', status: 'staff' },
			{ label: 'ACT: Low Potential', status: ctx.potential === 'low' ? 'met' : 'staff' },
		],
		perks: (f) =>
			f.standEvolution === 'Requiem'
				? ['A unique, abstract and very powerful ability', 'S Rank in every stat while active', 'Reverts when you win or lose, then a 4-RP cooldown']
				: f.standEvolution === 'ACT'
					? ['Your Stand metamorphoses as you mature, usually stopping at ACT 3 or 4', '+3 points per ACT (any stat but Dev. Potential)', 'Metamorphosis replaces the Awakening gauge']
					: ['Evolved: a second ability reflecting your awakened one, +6 stat points (permanent)', 'Requiem: S Rank in all stats while active (temporary)', 'ACT: +3 points per ACT (permanent)'],
		confirm: 'staff confirm the Arrow (or the ACT).',
	},
];

// Tokyo Ghoul: Kakuja (cannibalism), a Special Rc ability, and the One-Eyed and Quinx sub-species.
const tokyoGhoul: PotentialDef[] = [
	{
		id: 'kakuja',
		label: 'Kakuja',
		about: 'Repeatedly eating other Ghouls mutates your Rc Cells: half the Rc you gain from a Ghoul becomes Mutated Rc (M-Rc), and your Kagune turns into armor around your body.',
		group: 'Kakuja',
		keys: ['kakuja', 'kakujaForm'],
		reached: (f) => !blankText(f.kakuja),
		requirements: (f) => {
			const next = KAKUJA[Math.min(KAKUJA.findIndex((k) => k.id === f.kakuja) + 1, KAKUJA.length - 1)];
			const mrc = num(f.mutatedRc);
			return [
				{ label: 'A Kagune', status: hasKagune(f) && !isQuinx(f) ? 'met' : 'unmet' },
				{ label: `${next.mrc} M-Rc for ${next.id}`, status: mrc >= next.mrc ? 'met' : 'unmet', progress: [mrc, next.mrc], detail: 'Track M-Rc on the Rc Tank tab' },
			];
		},
		perks: (f) => {
			const at = KAKUJA.findIndex((k) => k.id === f.kakuja);
			const stages = KAKUJA.map((k) => `${k.id} (${k.mrc} M-Rc): ${k.boost}`);
			return [...(at < 0 ? stages : [KAKUJA[at].boost]), 'Incomplete: you lose all reason and attack everything, unless you have Ghoulish Affinity', 'M-Rc can still be spent on your Kagune, so don’t burn through it'];
		},
		confirm: 'staff confirm the M-Rc and the Ghouls eaten.',
	},
	{
		id: 'specialRc',
		label: 'Special Rc ability',
		about: 'Very rarely, a Kagune develops a special ability, much like a Cursed Energy Property.',
		group: 'Special Rc',
		keys: ['specialRc'],
		reached: (f) => !blankText(f.specialRc),
		requirements: (f, ctx) => [
			{ label: 'A Kagune', status: hasKagune(f) ? 'met' : 'unmet' },
			{ label: `The ${AFFINITY_TRAIT} trait`, status: ctx.traits.includes(AFFINITY_TRAIT) ? 'met' : 'unmet' },
			{ label: 'It develops in RP', status: 'staff' },
		],
		perks: () => ['A special ability on top of your Kagune type'],
		confirm: 'staff confirm the ability.',
	},
	{
		id: 'oneEyed',
		label: 'One-Eyed Ghoul',
		about: 'A rare human-Ghoul hybrid with one kakugan. Most Ghouls think it’s a myth. Start as one with the Combo trait, or become one in RP through a GM-approved event (like a human receiving a Ghoul’s organs).',
		group: 'One-Eyed',
		keys: ['oneEyed', 'oneEyedHow'],
		reached: isOneEyed,
		requirements: (f, ctx) => [
			{ label: 'Not a Quinx', status: isQuinx(f) ? 'unmet' : 'met', detail: 'a Quinx can’t also be One-Eyed', blocksStart: true },
			ctx.combos?.includes(ONE_EYED_COMBO)
				? { label: `The ${ONE_EYED_COMBO} Combo trait`, status: 'met', detail: 'You have it, so you can start as one', grantsStart: `Unlocked by your ${ONE_EYED_COMBO} Combo trait.` }
				: { label: `The ${ONE_EYED_COMBO} Combo trait (to start as one), or a GM-approved event in RP`, status: 'staff' },
		],
		perks: () => ['Starts at 6B (Power 36) instead of 4C', '4× physical gains (+4 with traits)', 'Growing costs 50 Rc a Sub-Tier, 200 a Primary Tier; −50 Rc on every other cost', 'Lose only 8 Rc a Roleplay'],
		confirm: 'staff confirm the Combo trait or the event.',
		startPermission: true,
	},
	{
		id: 'quinx',
		label: 'Quinx',
		about: 'A human with a surgically implanted, restrained kakuhou. Only the CCG makes them, usually as a death-sentence punishment. In RP only.',
		group: 'Quinx',
		keys: ['quinx', 'quinxFrames', 'rcTank'],
		reached: isQuinx,
		requirements: (f) => [
			{ label: 'Human', status: isGhoul(f) ? 'unmet' : 'met' },
			{ label: 'Not One-Eyed', status: isOneEyed(f) ? 'unmet' : 'met' },
			{ label: 'Made by the CCG in RP', status: 'staff' },
		],
		perks: () => [
			'A Kagune, restrained by 5 frames: −2 Sub-Tiers on all boosts per frame',
			'Each promotion removes a frame',
			'Immune to starvation (at 0 Rc you just can’t use your Kagune); lose 13 Rc a Roleplay',
			'Your Rc Tank starts at 0 and grows as you eat',
			'Lives 100 Roleplays, then dies a natural death',
		],
		perksLabel: 'What it means',
		confirm: 'staff confirm the CCG surgery (and each frame removed).',
	},
];

// inFAMOUS: the Karma Bomb, from Core Relays.
const infamous: PotentialDef[] = [
	{
		id: 'karmaBomb',
		label: 'Karma Bomb',
		about: 'An ultra-powerful single move that can overwhelm up to 21A Defense. Absorbing Core Relays unlocks the Karmic Streak, and acts that fit your Karma path fill it.',
		group: 'Karma Bomb',
		keys: ['karmaBomb', 'karmicStreak'],
		reached: (f) => !blankText(f.karmaBomb),
		requirements: (f) => {
			const relays = num(f.coreRelays);
			const fits = ['Elemental', 'Energy'].includes(String(f.class));
			return [
				f.class === 'Meta'
					? { label: 'A Mimic-type Meta Conduit', status: 'staff' }
					: { label: 'An Elemental or Energy Conduit', status: fits ? 'met' : 'unmet', detail: `You’re ${f.class ? `a ${String(f.class)} Conduit` : 'not a Conduit class yet'}` },
				{ label: `${KARMA_BOMB_RELAYS} Core Relays absorbed`, status: relays >= KARMA_BOMB_RELAYS ? 'met' : 'unmet', progress: [Math.min(relays, KARMA_BOMB_RELAYS), KARMA_BOMB_RELAYS], detail: 'Track them on the Evolution tab' },
			];
		},
		perks: () => [
			'Unlocks the Karmic Streak: fill it with 100 PK or NK from acts that fit your path',
			'It carries over between RPs, so you can fill it before a tough fight',
			'Unleash it to overwhelm up to 21A Defense',
			'Using it also gives 120 PK/NK toward your Karma Rank only',
		],
		confirm: 'staff confirm the Core Relays and the Karmic Streak.',
	},
];

export const POTENTIALS: Record<string, PotentialDef[]> = { quirk, abilities, 'fire-force': fireForce, jojo, 'tokyo-ghoul': tokyoGhoul, infamous };

export const potentialsFor = (system: string) => POTENTIALS[system] ?? [];

/** The parts of a sheet a potential's requirements read. */
export const potentialCtxOf = (sheet: { potential: { grade: string }; traits: { name: string }[]; systems: { system: string }[] }, combos?: string[]): PotentialCtx => ({
	potential: sheet.potential.grade,
	traits: sheet.traits.map((t) => t.name),
	combos,
	systemCounts: sheet.systems.reduce<Record<string, number>>((n, e) => ({ ...n, [e.system]: (n[e.system] ?? 0) + 1 }), {}),
});

const blank = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
const same = (a: unknown, b: unknown) => (blank(a) && blank(b)) || String(a) === String(b);

/** Whether the card's fields for it differ from the starting (default) ones, or from `before`. */
export function potentialChanged(p: PotentialDef, fields: Fields, defaults: Fields, before?: Fields) {
	const value = (src: Fields, k: string) => src[k] ?? defaults[k];
	return p.keys.some((k) => !same(value(fields, k), before ? value(before, k) : defaults[k]));
}

export interface PotentialState {
	open: boolean;
	/** Why it's open, or what to do while it's locked. */
	reason: string;
	requirements: Requirement[];
}

/** Whether the tab is open and why. */
export function potentialState(
	p: PotentialDef,
	entry: { key: string; fields: Fields },
	ctx: PotentialCtx & { isEvolution?: boolean; staffOverrides?: Record<string, unknown> | null },
): PotentialState {
	const requirements = p.requirements(entry.fields, ctx).filter((r) => !(ctx.isEvolution && r.startOnly));
	if (p.keys.some((k) => ctx.staffOverrides?.[`card:${entry.key}.${k}`] !== undefined)) return { open: true, reason: 'Unlocked by staff.', requirements };
	const granted = requirements.find((r) => r.status === 'met' && r.grantsStart);
	if (!ctx.isEvolution && granted && !requirements.some((r) => r.status === 'unmet' && r.blocksStart)) return { open: true, reason: granted.grantsStart!, requirements };
	if (!ctx.isEvolution && p.startPermission) {
		const blocked = requirements.find((r) => r.status === 'unmet' && r.blocksStart);
		if (blocked) return { open: false, reason: `You can’t have this: ${blocked.detail ?? blocked.label}.`, requirements };
		return { open: true, reason: 'New characters start without this. Starting with it needs staff permission: fill it in and staff decide when they review.', requirements };
	}
	if (!ctx.isEvolution) return { open: false, reason: 'New characters start without this. Once you’re approved, it opens here when you meet the requirements.', requirements };
	if (p.reached(entry.fields)) return { open: true, reason: 'Your character has this. Update it here as it grows.', requirements };
	if (requirements.every((r) => r.status !== 'unmet'))
		return { open: true, reason: 'You meet the requirements your sheet can show. Fill it in, and staff confirm the rest when they review your evolution.', requirements };
	return { open: false, reason: 'Meet the requirements below to open this.', requirements };
}
