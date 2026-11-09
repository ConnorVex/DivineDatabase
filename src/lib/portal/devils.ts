// Chainsaw Man numbers from the Index (Devil Basics, Fiends & Hybrids, Devil Evolution): a card's
// Blood Tank, Devil Ability Power and Regeneration come from its class, path and Fear Point upgrades.
import type { Fields } from './systems.ts';

export interface DevilClass {
	id: 'Mundane' | 'Rational' | 'Irrational' | 'Primal';
	/** Starting Blood Tank (BP). */
	tank: number;
	/** What the Blood Tank becomes at its max upgrade. */
	max: number;
	/** Starting Devil Ability Power. */
	dap: number;
	/** A Hybrid's stat boost (Sub-Tiers) when fully / partly transformed. */
	boost: [number, number];
	fears: string;
}

export const DEVIL_CLASSES: DevilClass[] = [
	{ id: 'Mundane', tank: 170, max: 300, dap: 5, boost: [3, 1.5], fears: 'Very niche fears. The weakest: even a human can kill one easily.' },
	{ id: 'Rational', tank: 200, max: 350, dap: 20, boost: [6, 3], fears: 'Fears people see as reasonable. A huge jump from Mundane, and highly aggressive.' },
	{ id: 'Irrational', tank: 230, max: 400, dap: 40, boost: [8, 4], fears: 'Irrational fears, often more potent. Much stronger than Rational.' },
	{ id: 'Primal', tank: 270, max: 450, dap: 80, boost: [15, 7.5], fears: 'Fears shared by nearly all humans. Nigh impossible to kill; top of the hierarchy.' },
];

export const devilClassOf = (f: Fields) => DEVIL_CLASSES.find((c) => c.id === f.devilClass);

/** Blood Tank upgrades 1–6: BP added and Fear Point cost. Then Max makes it the class max (the Index lists no cost). */
export const TANK_STEPS: { add: number; cost: number }[] = [
	{ add: 10, cost: 10 },
	{ add: 10, cost: 15 },
	{ add: 10, cost: 15 },
	{ add: 10, cost: 20 },
	{ add: 10, cost: 20 },
	{ add: 30, cost: 20 },
];
/** The Max step's level (tankUpgrades). Staff confirm it, as the Index gives it no FP cost. */
export const TANK_MAX = TANK_STEPS.length + 1;
/** Past the max: +20 BP per 30 FP, forever. */
export const TANK_BONUS = { add: 20, cost: 30 };

/** Regeneration upgrades 1–5 (−10 BP each, 20 FP), then Max (50 FP) brings it to 50 BP. */
export const REGEN_STEPS: { cost: number }[] = [{ cost: 20 }, { cost: 20 }, { cost: 20 }, { cost: 20 }, { cost: 20 }, { cost: 50 }];
export const REGEN_START = 160;
export const REGEN_MAX = 50;

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);
const clamp = (n: number, hi: number) => Math.max(0, Math.min(hi, Math.floor(n)));

export const tankLevel = (f: Fields) => clamp(num(f.tankUpgrades), TANK_MAX);
export const tankBonus = (f: Fields) => clamp(num(f.tankBonus), 10_000);
export const regenLevel = (f: Fields) => clamp(num(f.regenUpgrades), REGEN_STEPS.length);

export const regenCost = (level: number) => (level >= REGEN_STEPS.length ? REGEN_MAX : REGEN_START - 10 * level);

export interface DevilStats {
	tank: number | null;
	dap: number | null;
	/** BP to Regenerate (Devils), or how a Fiend or Hybrid heals. */
	healing: string | null;
	/** Whether the Blood Tank can take Fear Point upgrades. */
	upgradeable: boolean;
}

/** What the card's class, path and upgrades work out to. */
export function devilStats(f: Fields): DevilStats {
	const c = devilClassOf(f);
	const path = String(f.path ?? '');
	if (!c || path === 'Human with contracts' || !path) return { tank: null, dap: null, healing: null, upgradeable: false };
	if (path === 'Fiend') return { tank: Math.floor(c.tank / 2), dap: c.dap / 2, healing: 'Heals all injuries for 5.8 BP', upgradeable: false };
	if (path === 'Hybrid') return { tank: 350, dap: c.dap, healing: '50 BP per injury', upgradeable: false };
	const level = tankLevel(f);
	const tank = level >= TANK_MAX ? c.max + TANK_BONUS.add * tankBonus(f) : c.tank + TANK_STEPS.slice(0, level).reduce((n, s) => n + s.add, 0);
	return { tank, dap: c.dap, healing: `Regenerate for ${regenCost(regenLevel(f))} BP`, upgradeable: true };
}

/** Fear Points spent on upgrades so far. */
export function fearSpent(f: Fields) {
	const tank = TANK_STEPS.slice(0, tankLevel(f)).reduce((n, s) => n + s.cost, 0) + TANK_BONUS.cost * tankBonus(f);
	const regen = REGEN_STEPS.slice(0, regenLevel(f)).reduce((n, s) => n + s.cost, 0);
	return tank + regen;
}

/** The stored Blood Tank and DAP fields, kept in step with the class, path and upgrades. */
export function deriveDevil(f: Fields): Fields {
	const s = devilStats(f);
	return { bloodTank: s.tank ?? undefined, dap: s.dap ?? undefined };
}

/** The card's Fear Point fields, locked until approval. */
export const FEAR_KEYS = ['fearPoints', 'tankUpgrades', 'tankBonus', 'regenUpgrades'];

/** The next class up, for Metamorphosis. */
export const nextClass = (f: Fields) => {
	const at = DEVIL_CLASSES.findIndex((c) => c.id === f.devilClass);
	return at >= 0 ? DEVIL_CLASSES[at + 1] : undefined;
};
