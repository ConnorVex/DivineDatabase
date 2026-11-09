// Evolution rolls made on a power system's own tab (the database rolls them: roll_evolution in
// 20261125100000_evolution_rolls.sql). This mirrors its rules so the tab shows what can be rolled.
// Rates from the Index (Quirk Evolution, Overclocking, Stand Basics, Conduit Evolution; Fire Force: Adolla).

export type EvolutionRollKind = 'quirk_instability' | 'quirk_evolution' | 'overclock_instability' | 'stand_arrow' | 'arc_roll' | 'adolla_peek';

export interface EvolutionRoll {
	id: number;
	card_key: string;
	kind: EvolutionRollKind;
	sides: number;
	roll: number;
	result: string;
	created_at: string;
}

export const EVOLUTION_DICE: Record<EvolutionRollKind, { sides: number; name: string }> = {
	quirk_instability: { sides: 1000, name: 'Quirk Instability' },
	quirk_evolution: { sides: 10000, name: 'Spontaneous Evolution' },
	overclock_instability: { sides: 10, name: 'Overclock Instability' },
	stand_arrow: { sides: 1000, name: 'Stand Arrow' },
	arc_roll: { sides: 1000, name: 'Arc Roll' },
	adolla_peek: { sides: 10, name: 'Adolla Link peek' },
};

/** Same as evolution_roll_result in the database. */
export function evolutionResult(kind: EvolutionRollKind, roll: number): string {
	if (kind === 'quirk_instability') return roll >= 500 ? 'unstable' : 'stable';
	if (kind === 'stand_arrow') return roll >= 700 ? 'arrow' : 'no_arrow';
	if (kind === 'arc_roll') return roll >= 900 ? 'core_relay' : roll >= 791 ? 'blast_core' : roll >= 500 ? 'blast_shard' : 'no_item';
	if (kind === 'adolla_peek') return roll >= 5 ? 'seen' : 'unseen';
	if (kind === 'overclock_instability') return roll <= 5 ? 'steady' : roll <= 9 ? 'exit' : 'lost';
	if (roll <= 1000) return 'nothing';
	if (roll <= 5000) return 'awakening';
	if (roll <= 7999) return 'plus';
	if (roll <= 9949) return 'maximum';
	return 'infinite';
}

/** What a result means, for people. */
export const RESULT_TEXT: Record<string, string> = {
	unstable: 'Unstable for 3 RPs',
	stable: 'No instability',
	nothing: 'Nothing happened',
	awakening: 'Quirk Awakening',
	plus: 'Plus Variant',
	maximum: 'Maximum Variant',
	infinite: 'Infinite Variant',
	steady: 'Nothing happens',
	exit: 'Overclock ends: 10-turn cooldown',
	lost: 'Ability gone for good',
	arrow: 'Found a Stand Arrow',
	no_arrow: 'No Stand Arrow',
	no_item: 'Nothing found',
	blast_shard: 'Blast Shard',
	blast_core: 'Blast Core',
	core_relay: 'Core Relay (Mainland only)',
	seen: 'Peered into the Link',
	unseen: 'Couldn’t see in',
};

/** A Variant result's value for the card's `variant` field. */
export const VARIANT_OF: Record<string, string> = { plus: 'Plus', maximum: 'Maximum', infinite: 'Infinite' };

export type QuirkRollStage =
	/** Can roll for Instability. */
	| 'instability'
	/** Unstable: roll for Spontaneous Evolution at the end. */
	| 'unstable'
	/** 3 failed rolls in a row: redo the requirements, then staff reset the rolls. */
	| 'failed';

/** Where a Quirk card's rolls stand (oldest first), like roll_evolution checks it. */
export function quirkRollStage(rolls: EvolutionRoll[]): { stage: QuirkRollStage; fails: number } {
	const ordered = rolls.filter((r) => r.kind.startsWith('quirk_')).sort((a, b) => a.id - b.id);
	const lastInstability = ordered.filter((r) => r.kind === 'quirk_instability').at(-1);
	const evolved = Boolean(lastInstability && ordered.some((r) => r.kind === 'quirk_evolution' && r.id > lastInstability.id));
	let fails = 0;
	for (const r of [...ordered].reverse()) {
		if (r.result === 'unstable' || r.kind === 'quirk_evolution') break;
		if (r.kind === 'quirk_instability' && r.result === 'stable') fails++;
	}
	if (lastInstability?.result === 'unstable' && !evolved) return { stage: 'unstable', fails };
	return { stage: fails >= 3 ? 'failed' : 'instability', fails };
}

/**
 * Cooldowns in real-life time until RPs are tracked: one RP is a day (same as roll_evolution).
 * Instability is rolled at most once per RP, and Spontaneous Evolution only after the 3 unstable RPs.
 */
export const RP_MS = 24 * 60 * 60 * 1000;
export const UNSTABLE_RPS = 3;

/** When this Quirk card can roll next (null: now), and how many unstable RPs have passed. */
export function quirkCooldown(rolls: EvolutionRoll[], now = Date.now(), rpMs = RP_MS) {
	const ordered = rolls.filter((r) => r.kind.startsWith('quirk_')).sort((a, b) => a.id - b.id);
	const { stage } = quirkRollStage(rolls);
	const at = (r: EvolutionRoll | undefined) => (r ? new Date(r.created_at).getTime() : 0);
	if (stage === 'unstable') {
		const since = at(ordered.filter((r) => r.kind === 'quirk_instability').at(-1));
		const ready = since + UNSTABLE_RPS * rpMs;
		return { readyAt: ready > now ? ready : null, rpsDone: Math.min(UNSTABLE_RPS, Math.floor((now - since) / rpMs)) };
	}
	const last = ordered.at(-1);
	const ready = last ? at(last) + rpMs : 0;
	return { readyAt: ready > now ? ready : null, rpsDone: 0 };
}

/** A die's chance of each result, as percentages (e.g. 500+ on 1d1000 is 50.1%). */
export const chance = (from: number, to: number, sides: number) => {
	const pct = Math.round(((to - from + 1) / sides) * 1000) / 10;
	return `${pct}%`;
};

/** Overclock Instability: +10 a turn overclocked (−2 per upgrade), −5 a turn not using the ability, out of 100. */
export const overclockGain = (upgrades: number) => 10 - 2 * upgrades;
