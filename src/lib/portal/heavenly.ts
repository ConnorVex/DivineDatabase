// Heavenly Restrictions (Jujutsu Kaisen): Permission Based. Admins grant one to an account; the
// character that uses it gets its stats and loses every power system but JJK and Cyberpunk.
// What each one does is on the wiki: Power Systems → Jujutsu Kaisen → Heavenly Restriction.
import ranksData from '../../data/portal/ranks.json' with { type: 'json' };
import type { Sheet } from './sheet.ts';

export const HEAVENLY = ['Physical', 'Cursed Energy', 'Cursed Twin', 'Physical Twin', 'Equilibrium'] as const;
export type Heavenly = (typeof HEAVENLY)[number];
export const isHeavenly = (v: unknown): v is Heavenly => HEAVENLY.includes(v as Heavenly);

/** The only power systems a Heavenly Restriction leaves you. */
export const HEAVENLY_SYSTEMS = ['jujutsu-kaisen', 'cyberpunk'];

/** Physical Restriction's stats sit below the rank table: Power −1. */
export const HEAVENLY_RANKS = [{ rank: '1G', tier: 1, phase: 0, value: -1 }];

const CE_KEYS = ['ceClass', 'ceAmount', 'ceOutput', 'ceControl', 'rp2rpRecharge', 'completeRecharge', 'ceUpgradePoints'];
const CT_KEYS = ['ctName', 'ctType', 'ctClass', 'ctRange', 'ctPower', 'ctEfficiency', 'ctUpgradePoints'];
const CEU_ONLY = 'Cursed Energy Utilization only';

/** Equilibrium: the CE class sets the phase. */
const EQUILIBRIUM_PHASE: Record<string, number> = { Common: 0, Uncommon: 1, Rare: 1, Legendary: 2, Mythical: 3 };

/** The middle rank of a phase, e.g. Phase 1 (Tiers 3–8) → 5C. */
function middleRank(phase: number) {
	const inPhase = ranksData.ranks.filter((r) => r.phase === phase);
	return inPhase[Math.floor((inPhase.length - 1) / 2)]?.rank ?? '';
}

export interface HeavenlyEffect {
	/** Strength, Speed, Defense and Stamina start here. */
	baseRank?: string;
	/** …and stay there: the player can't change them. */
	lockStats?: boolean;
	baseIntelligence?: string;
	/** …and Intelligence stays there too. */
	lockIntelligence?: boolean;
	/** The phase it puts you in; hops up to it are free. */
	phase?: number;
	lockPhase?: boolean;
	/** Extra starting PTP. */
	ptp?: number;
	/** JJK card fields it sets. */
	fixed: Record<string, string | number>;
	/** JJK card fields it takes away. */
	hidden: string[];
	/** No Extension Techniques (no Cursed Technique). */
	noTechnique?: boolean;
	/** What it gives, for the banner and the card. */
	perks: string[];
}

export function heavenlyEffect(hr: unknown, fields: Record<string, unknown> = {}): HeavenlyEffect | null {
	switch (hr) {
		case 'Physical':
			return {
				baseRank: '1G',
				lockStats: true,
				phase: 0,
				lockPhase: true,
				fixed: { ceClass: 'Heavenly', ceAmount: 12000, ceControl: 5, ctRange: 'Heavenly' },
				hidden: [],
				perks: [
					'Heavenly CE Level: 12,000 CEP',
					'Starts at CE Control Level 5',
					'Heavenly Output: +20 Power for your Cursed Technique (not physical)',
					'Heavenly Range: your CT reaches all Mainland territories',
					'Weakness: everything hurts, sunlight burns, and you can’t walk',
				],
			};
		case 'Cursed Energy':
			return {
				baseRank: '13F',
				lockStats: true,
				baseIntelligence: 'Gifted',
				lockIntelligence: true,
				phase: 2,
				lockPhase: true,
				fixed: { start: CEU_ONLY },
				hidden: ['start', ...CE_KEYS, ...CT_KEYS],
				noTechnique: true,
				perks: ['Strength, Speed, Defense and Stamina: 13F; Intelligence: Gifted (fixed starting stats)', 'Enhanced Senses: perceive curses without CE', 'Soul Sense: use weapons like the Soul Split Katana', 'No Cursed Energy at all'],
			};
		case 'Cursed Twin':
			return {
				fixed: { ceClass: 'Heavenly Twin', ceAmount: 5, ctEfficiency: 'Heavenly Twin' },
				hidden: [],
				perks: ['CE Level: Heavenly Twin (5 CEP)', 'CT Efficiency: Heavenly Twin (5 CEP per use)', 'If the Physical Twin dies: the Physical Restriction’s benefits without its weakness (staff update this)'],
			};
		case 'Physical Twin':
			return {
				baseRank: '6F',
				lockStats: true,
				baseIntelligence: 'Above Average',
				lockIntelligence: true,
				phase: 1,
				lockPhase: true,
				fixed: { start: CEU_ONLY },
				hidden: ['start', ...CT_KEYS],
				noTechnique: true,
				perks: ['Strength, Speed, Defense and Stamina: 6F', 'Intelligence: Above Average', 'No Cursed Technique', 'If the Cursed Twin dies: the Cursed Energy Restriction (staff update this)'],
			};
		case 'Equilibrium': {
			const phase = EQUILIBRIUM_PHASE[String(fields.ceClass ?? '')];
			return {
				...(phase === undefined ? {} : { baseRank: middleRank(phase), lockStats: true, phase, lockPhase: true }),
				fixed: {},
				hidden: [],
				perks: [
					phase === undefined ? 'Roll your Cursed Energy: its class sets your phase' : `Phase ${phase} from your CE class: physical stats fixed at ${middleRank(phase)}`,
					'Losing CE weakens you: −2 Sub-Tiers per 10 CEP for the first 30 CEP, then −4 per 10 CEP',
					'At 0 CE you pass out',
				],
			};
		}
		default:
			return null;
	}
}

const jjkCard = (sheet: Sheet) => sheet.systems.find((e) => e.system === 'jujutsu-kaisen');

/** The sheet's Heavenly Restriction, if it has one. */
export function heavenlyOf(sheet: Sheet): Heavenly | null {
	const hr = jjkCard(sheet)?.fields.heavenlyRestriction;
	return isHeavenly(hr) ? hr : null;
}

export const sheetHeavenly = (sheet: Sheet) => {
	const card = jjkCard(sheet);
	return heavenlyEffect(card?.fields.heavenlyRestriction, card?.fields);
};

/** Puts a granted restriction on the sheet: a JJK card if there's none, its fields and the stats it sets.
 * Returns false when nothing needed to change. */
export function applyHeavenly(
	sheet: Sheet,
	hr: Heavenly,
	newKey: () => string,
	jjkDefaults: () => Record<string, string | number | string[]>,
	/** Paths staff set, which it leaves alone. */
	staffSet: (path: string) => boolean = () => false,
): boolean {
	const before = JSON.stringify(sheet);
	let card = jjkCard(sheet);
	if (!card) {
		card = { key: newKey(), system: 'jujutsu-kaisen', fields: jjkDefaults(), description: '', skills: [], rollProofs: {} };
		sheet.systems.push(card);
		if (sheet.systems.length === 1) sheet.prioritySystem = card.key;
	}
	card.fields.heavenlyRestriction = hr;
	const effect = heavenlyEffect(hr, card.fields)!;
	for (const [key, value] of Object.entries(effect.fixed)) if (!staffSet(`card:${card.key}.${key}`)) card.fields[key] = value;
	if (effect.baseRank) {
		for (const stat of ['strength', 'speed', 'defense', 'stamina'] as const) {
			if ((effect.lockStats || !sheet.stats[stat]) && !staffSet(`stats.${stat}`)) sheet.stats[stat] = effect.baseRank;
		}
	}
	if (effect.baseIntelligence && (effect.lockIntelligence || sheet.stats.intelligence === 'Average') && !staffSet('stats.intelligence')) sheet.stats.intelligence = effect.baseIntelligence;
	if (effect.phase !== undefined && (effect.lockPhase || sheet.stats.phase < effect.phase) && !staffSet('stats.phase')) sheet.stats.phase = effect.phase;
	return JSON.stringify(sheet) !== before;
}
