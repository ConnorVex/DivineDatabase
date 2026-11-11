// Own scaling for a custom power's skills: a power that doesn't follow its series' usual scaling
// (e.g. a Cursed Technique whose Extensions don't cost CT Efficiency or use CT Power). Each skill sets
// its own cost and power, whether it's there from the start, special effects, a trait it needs, and the
// upgrades that raise its power or cut its cost. Admins enter all of it in the Power Builder.
import type { Skill } from './sheet.ts';

export type CostMode = 'standard' | 'fixed' | 'dependent' | 'none';
export type PowerMode = 'standard' | 'fixed' | 'dependent' | 'infinite';

export interface ScalingUpgrade {
	name: string;
	/** power: adds `amount` to the power; cost: takes `amount` off the cost; other: `note` says what. */
	kind: 'power' | 'cost' | 'other';
	amount: number;
	note: string;
}

export interface SkillScaling {
	cost: CostMode;
	costAmount: number;
	/** e.g. "per use"; shown after the amount. */
	costNote: string;
	power: PowerMode;
	powerAmount: number;
	/** What "Dependent" depends on, or anything else about the power. */
	powerNote: string;
	/** Whether the player starts with it or unlocks it later. */
	access: 'starting' | 'locked';
	effects: string[];
	requiredTrait: string;
	upgrades: ScalingUpgrade[];
}

/** The power's own scaling, set on the power: on, and the technique's tags (e.g. a grade or clan). */
export interface PowerScaling {
	custom: boolean;
	tags: string[];
}

export const blankScaling = (): SkillScaling => ({
	cost: 'standard',
	costAmount: 0,
	costNote: '',
	power: 'standard',
	powerAmount: 0,
	powerNote: '',
	access: 'starting',
	effects: [],
	requiredTrait: '',
	upgrades: [],
});

export const blankUpgrade = (): ScalingUpgrade => ({ name: '', kind: 'power', amount: 5, note: '' });

/** What a series calls these, and what its usual scaling is. */
export interface ScalingLabels {
	cost: string;
	unit: string;
	power: string;
	standardCost: string;
	standardPower: string;
	skill: string;
}

const LABELS: Record<string, ScalingLabels> = {
	'jujutsu-kaisen': { cost: 'CE Cost', unit: 'CEP', power: 'ET Power', standardCost: 'CT Efficiency', standardPower: 'CT Power', skill: 'Extension' },
};
const GENERIC: ScalingLabels = { cost: 'Cost', unit: 'points', power: 'Power', standardCost: 'the usual cost', standardPower: 'the card’s power', skill: 'Skill' };

export const scalingLabels = (system: string | undefined): ScalingLabels => LABELS[system ?? ''] ?? GENERIC;

const num = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0);
const clean = (list: unknown) => (Array.isArray(list) ? list.map((x) => String(x ?? '').trim()).filter(Boolean) : []);

/** Fills in anything missing from a saved scaling. */
export function normalizeScaling(raw: unknown): SkillScaling {
	const s = { ...blankScaling(), ...(raw && typeof raw === 'object' ? raw : {}) } as SkillScaling;
	return {
		...s,
		costAmount: num(s.costAmount),
		powerAmount: num(s.powerAmount),
		effects: clean(s.effects),
		requiredTrait: String(s.requiredTrait ?? '').trim(),
		upgrades: Array.isArray(s.upgrades) ? s.upgrades.map((u) => ({ ...blankUpgrade(), ...u, amount: num(u?.amount) })) : [],
	};
}

/** The power and cost with every upgrade bought: { power, cost }, or null where there's no fixed number. */
export function upgradedTotals(s: SkillScaling): { power: number | null; cost: number | null } {
	const sum = (kind: ScalingUpgrade['kind']) => s.upgrades.filter((u) => u.kind === kind).reduce((t, u) => t + num(u.amount), 0);
	return {
		power: s.power === 'fixed' ? s.powerAmount + sum('power') : null,
		cost: s.cost === 'fixed' ? Math.max(0, s.costAmount - sum('cost')) : null,
	};
}

/** The tags a skill shows, e.g. ["CE Cost: 50 CEP per use (down to 30)", "ET Power: Infinite", "Locked Extension"]. */
export function scalingTags(skill: Pick<Skill, 'scaling'>, labels: ScalingLabels): { text: string; kind: 'cost' | 'power' | 'access' | 'effect' | 'trait' }[] {
	if (!skill.scaling) return [];
	const s = normalizeScaling(skill.scaling);
	const top = upgradedTotals(s);
	const out: ReturnType<typeof scalingTags> = [];
	const note = (n: string) => (n.trim() ? ` ${n.trim()}` : '');
	if (s.cost === 'fixed') out.push({ kind: 'cost', text: `${labels.cost}: ${s.costAmount} ${labels.unit}${note(s.costNote)}${top.cost !== null && top.cost !== s.costAmount ? ` (down to ${top.cost})` : ''}` });
	else if (s.cost === 'dependent') out.push({ kind: 'cost', text: `${labels.cost}: Dependent${s.costNote.trim() ? ` (${s.costNote.trim()})` : ''}` });
	else if (s.cost === 'none') out.push({ kind: 'cost', text: `${labels.cost}: None` });
	if (s.power === 'fixed') out.push({ kind: 'power', text: `${labels.power}: ${s.powerAmount}${top.power !== null && top.power !== s.powerAmount ? ` (up to ${top.power})` : ''}` });
	else if (s.power === 'dependent') out.push({ kind: 'power', text: `${labels.power}: Dependent${s.powerNote.trim() ? ` (${s.powerNote.trim()})` : ''}` });
	else if (s.power === 'infinite') out.push({ kind: 'power', text: `${labels.power}: Infinite` });
	out.push({ kind: 'access', text: `${s.access === 'locked' ? 'Locked' : 'Starting'} ${labels.skill}` });
	for (const e of s.effects) out.push({ kind: 'effect', text: e });
	if (s.requiredTrait) out.push({ kind: 'trait', text: `Required Trait: ${s.requiredTrait}` });
	return out;
}

/** "+5 ET Power", "−15 CE Cost", or the note. */
export function upgradeText(u: ScalingUpgrade, labels: ScalingLabels): string {
	if (u.kind === 'power') return `+${num(u.amount)} ${labels.power}`;
	if (u.kind === 'cost') return `−${num(u.amount)} ${labels.unit}`;
	return u.note.trim();
}

/** Skills on the card that need a trait the character doesn't have (locked ones aren't used yet). */
export function missingTraits(skills: Skill[], traits: string[]): { skill: string; trait: string }[] {
	const have = new Set(traits);
	return skills
		.filter((sk) => !sk.locked && sk.scaling && normalizeScaling(sk.scaling).access !== 'locked')
		.map((sk) => ({ skill: sk.name || 'unnamed', trait: normalizeScaling(sk.scaling).requiredTrait }))
		.filter((x) => x.trait && !have.has(x.trait));
}
