// Live rule checks for the submit form. Everything here is a pure function of the sheet,
// so the same checks can run in the form, on the admin dashboard and in tests.
import { currencyChanged, treeProblems } from './customTree.ts';
import { missingTraits } from './skillScaling.ts';
import { HEAVENLY_RANKS, HEAVENLY_SYSTEMS, heavenlyOf, sheetHeavenly } from './heavenly.ts';
import { DIVINE_PHASE, DIVINE_RANKS } from './divine.ts';
import ranksData from '../../data/portal/ranks.json' with { type: 'json' };
import rulesData from '../../data/portal/rules.json' with { type: 'json' };
import traitsData from '../../data/portal/traits.json' with { type: 'json' };
import type { LinkablePerk } from './families.ts';
import { powerCardChanged, type MyPowerGrant } from './powerCards.ts';
import { PROOF_LABEL, familyCardChanged, type PickedTrait, type Sheet, type SystemEntry } from './sheet.ts';
import { BARRIER_KEYS, barrierUnlocked, barrierUsed, canonHolder, abilitySystem, countsTowardLimit, pastStart, startText, systemById, visibleFields, type Field, type Fields } from './systems.ts';
import { potentialChanged, potentialCtxOf, potentialsFor } from './potentials.ts';
import { DEVIL_CLASSES, FEAR_KEYS, TANK_MAX } from './devils.ts';
import { AFFINITY_TRAIT } from './ghouls.ts';
import { CONDUIT_FIELDS, ITEMS, PUPPET_TARGETS, puppetsOf } from './conduits.ts';
import { canonQuirk } from './canonQuirks.ts';
import { canonIgnition } from './canonIgnitions.ts';
import { canonStandFields } from './canonStands.ts';
import { canonConduitFields } from './canonConduits.ts';
import { techniqueLog } from './fireforceLogs.ts';
import { HAMON_TRACKS, SPIN_TRACKS, hasStand, trackLevel } from './jojo.ts';
import { ADAPTATION_TRAIT, TECHNIQUE_COST, TEPHROSIS, pointsOf } from './fireforce.ts';

/** The picked canon Ignition's id and what it fixes on the card holding it ({} when none is picked). */
const fireClaim = (ctx: { requestedClaims?: string[]; claims?: Map<string, { name: string; category?: string; universe?: string; claimType?: string }> }) => {
	const id = (ctx.requestedClaims ?? []).find((x) => ctx.claims?.get(x)?.universe === 'fire-force' && ctx.claims?.get(x)?.claimType === 'ability');
	return { id, fixed: canonIgnition(id ? ctx.claims?.get(id) : undefined) };
};

export const ranks = ranksData.ranks;
export const rules = rulesData;
export const traits = traitsData.traits;

const rankByName = new Map([...ranks, ...HEAVENLY_RANKS, ...DIVINE_RANKS].map((r) => [r.rank, r as (typeof ranks)[number]]));
const traitByName = new Map(traits.map((t) => [t.name, t]));
const slotsByRarity = new Map(rules.traitSlots.rarities.map((r) => [r.id, r.slots]));

/** 'error' blocks sending for review; 'warning' is shown to player and admins; 'permission' flags a pick that needs an admin's OK. */
export type IssueLevel = 'error' | 'warning' | 'permission' | 'approved' | 'ignored';
export interface Issue {
	level: IssueLevel;
	section: string;
	message: string;
	/** The system card it's about, if any. */
	card?: string;
}

export type StaffOverrides = Record<string, { from?: unknown; to?: unknown; by?: string; at?: string }>;
export const cardPath = (cardKey: string, field: string) => `card:${cardKey}.${field}`;

export interface CheckContext {
	kind: 'oc' | 'canon';
	name: string;
	canonUniverse?: string | null;
	/** Editing an already-approved character: starting budgets no longer apply. */
	isEvolution?: boolean;
	extraTraitSlots?: number;
	/** Extra starting PTP staff granted. */
	bonusPtp?: number;
	/** The approved sheet, when there is one: custom currency rates only need approval when they change. */
	approvedSheet?: Sheet | null;
	/** Claim board rows for the picked claims: id → usage. */
	claims?: Map<string, { name: string; usedSlots: number; maxUsers: number | null; category?: string; universe?: string; claimType?: string }>;
	/** Power-set limits from the character's discovered trait combinations. */
	comboSystemLimits?: Record<string, number>[];
	/** Names of the Combo traits the database found for the character. */
	combos?: string[];
	/** Claims this character already holds (don't count against it). */
	heldClaimIds?: Set<string>;
	requestedClaims?: string[];
	/** The Heavenly Restriction this character may use: the owner's unused grant, or the one it used.
	 * null when there's none; leave it out when it isn't known (no grant check then). */
	heavenlyGrant?: string | null;
	/** Values staff set, by path (stats.strength, potential.grade, card:<key>.<field>): exempt from the starting limits. */
	staffOverrides?: StaffOverrides;
	/** Staff marked the character as already progressed: no starting limits at all. */
	progressed?: boolean;
	/** An admin's own character: no rule checks or limits. */
	adminCharacter?: boolean;
	/** The owner asks for encryption (not yet approved), and why. */
	encryptionRequest?: { reason: string } | null;
	/** Families the character is in or is asking to join (ids). */
	families?: string[];
	/** Perks the character gets from its family's Inheritance (ids). */
	inheritedPerks?: Set<string>;
	/** The family perks the player can link, by id. Without it, linked cards aren't checked against their perk. */
	familyPerks?: Map<string, LinkablePerk>;
	/** The owner's granted powers (when loaded): a granted card must use one of them. */
	powerGrants?: MyPowerGrant[];
	/** The character being checked, so a grant it already uses still counts as its own. */
	characterId?: string | null;
}

export const rankValue = (rank: string) => rankByName.get(rank)?.value;
export const rankInfo = (rank: string) => rankByName.get(rank);

/** Power = (Strength value + Speed value) ÷ 2. */
export function power(sheet: Sheet): number | null {
	const str = rankValue(sheet.stats.strength);
	const spd = rankValue(sheet.stats.speed);
	return str === undefined || spd === undefined ? null : (str + spd) / 2;
}

const STAT_LABELS = { strength: 'Strength', speed: 'Speed', defense: 'Defense' } as const;

/** What a trait changes at the start (rules.json stats.traitPtp). */
interface TraitStart {
	trait: string;
	ptp?: number;
	noStartingPtp?: boolean;
	baseRanks?: Record<string, string>;
	baseIntelligence?: string;
	recoilFreeGap?: number;
	maxRecoil?: boolean;
	/** Extra starting points for a system's budget, by system id. */
	systemPoints?: Record<string, number>;
	/** Levels of a system field that start free, by system id then field key. */
	freeLevels?: Record<string, Record<string, number>>;
}

/** The start effects of the character's traits. */
export function traitStarts(sheet: Sheet): TraitStart[] {
	const picked = new Set(sheet.traits.map((t) => t.name));
	return (rules.stats.traitPtp as TraitStart[]).filter((t) => picked.has(t.trait));
}

/** How the character's traits (and Combo traits) change a system's start, for its card. */
export function traitEffectsFor(sheet: Sheet, systemId: string, combos: string[] = []): { trait: string; effect: string }[] {
	const def = systemById.get(systemId);
	if (!def) return [];
	const picked = new Set(sheet.traits.map((t) => t.name));
	const out: { trait: string; effect: string }[] = [];
	const label = (key: string) => def.fields.find((x) => x.key === key)?.label ?? key;
	for (const t of traitStarts(sheet)) {
		const points = t.systemPoints?.[systemId];
		if (points && def.budget) out.push({ trait: t.trait, effect: `+${points} starting ${def.budget.label}` });
		for (const [key, n] of Object.entries(t.freeLevels?.[systemId] ?? {})) out.push({ trait: t.trait, effect: `${label(key)} up to level ${n} is free` });
	}
	for (const t of rules.powerSets.traitLimits) {
		const n = (t.limits as Record<string, number>)[systemId];
		if (n && picked.has(t.trait)) out.push({ trait: t.trait, effect: `Up to ${n} ${def.label} cards` });
	}
	for (const field of def.fields) {
		const byTrait = new Map<string, string[]>();
		for (const o of field.options ?? []) if (o.trait && picked.has(o.trait)) byTrait.set(o.trait, [...(byTrait.get(o.trait) ?? []), o.value]);
		for (const [trait, values] of byTrait) out.push({ trait, effect: `Opens ${values.join(', ')} ${field.label}` });
	}
	if (systemId === 'jujutsu-kaisen' && picked.has('Barrier Prodigy')) out.push({ trait: 'Barrier Prodigy', effect: 'Start with Barrier Techniques' });
	for (const p of potentialsFor(systemId)) {
		const reqs = p.requirements({}, { ...potentialCtxOf(sheet, combos) });
		for (const r of reqs)
			if (r.status === 'met' && r.grantsStart)
				out.push({ trait: r.label.replace(/^The /, '').replace(/ trait$/, ''), effect: p.id === 'oneEyed' ? `Start as a ${p.label}` : p.id === 'esoteric' ? 'Esoteric Ability awake from the start' : `Start with ${p.label}` });
	}
	// One line per trait.
	const merged = new Map<string, string[]>();
	for (const t of out) merged.set(t.trait, [...(merged.get(t.trait) ?? []), t.effect]);
	return [...merged].map(([trait, effects]) => ({ trait, effect: effects.join(' · ') }));
}

/** Where a physical stat starts before any PTP: 1F, unless a system or trait says otherwise. */
export function statStart(sheet: Sheet, stat: string): number {
	const ghoul = sheet.systems.map((e) => systemById.get(e.system)?.baseStats?.(e.fields)).find(Boolean) ?? null;
	let from = rankValue(rules.stats.baseRank) ?? 1;
	if (ghoul?.stats.includes(stat)) from = rankValue(ghoul.rank) ?? from;
	for (const t of traitStarts(sheet)) if (t.baseRanks?.[stat]) from = rankValue(t.baseRanks[stat]) ?? from;
	const heavenly = sheetHeavenly(sheet);
	if (heavenly?.baseRank) from = rankValue(heavenly.baseRank) ?? from;
	return from;
}

/** A system card's starting points, with trait bonuses (extra points, free levels). Null when it has none. */
export function systemBudget(sheet: Sheet, entry: SystemEntry) {
	const def = systemById.get(entry.system);
	if (!def?.budget) return null;
	let total = def.budget.total(entry.fields);
	let spent = def.budget.spent(entry.fields);
	if (total > 0) {
		for (const t of traitStarts(sheet)) {
			total += t.systemPoints?.[entry.system] ?? 0;
			for (const [key, free] of Object.entries(t.freeLevels?.[entry.system] ?? {})) spent -= Math.min(free, Number(entry.fields[key]) || 0);
		}
	}
	return { label: def.budget.label, total, spent: Math.max(0, spent) };
}

/** Recoil: Strength, Speed and Defense must stay within 2 Sub-Tiers of each other (traits can change this). */
export function recoil(sheet: Sheet): { level: number; high: string; low: string; gap: number; freeGap: number } | null {
	const entries = (Object.keys(STAT_LABELS) as (keyof typeof STAT_LABELS)[])
		.map((key) => ({ key, value: rankValue(sheet.stats[key]) }))
		.filter((e): e is { key: keyof typeof STAT_LABELS; value: number } => e.value !== undefined);
	if (entries.length < 2) return null;
	entries.sort((a, b) => b.value - a.value);
	const high = entries[0];
	const low = entries.at(-1)!;
	const gap = high.value - low.value;
	const starts = traitStarts(sheet);
	const maxRecoil = starts.some((t) => t.maxRecoil);
	const freeGap = maxRecoil ? 0 : Math.max(rules.stats.recoilFreeGap, ...starts.map((t) => t.recoilFreeGap ?? 0));
	if (gap <= freeGap) return null;
	return { level: maxRecoil ? 3 : Math.min(3, gap - freeGap), high: STAT_LABELS[high.key], low: STAT_LABELS[low.key], gap, freeGap };
}

export function traitSlots(sheet: Sheet, extraSlots = 0) {
	const used = sheet.traits.reduce((sum, picked) => {
		if (picked.family) return sum + rules.traitSlots.familyTrait.slots;
		return sum + (slotsByRarity.get(traitByName.get(picked.name)?.rarity ?? '') ?? 1);
	}, 0);
	return { used, total: rules.traitSlots.base + extraSlots };
}

/** PTP spent on stats, Intelligence and Phase hops, and the starting PTP available:
 * the role's starting PTP plus bonuses from systems and traits. PTP earned in RP isn't
 * part of a new character's budget. */
/** `bonusPtp`: extra starting PTP staff granted this character. */
/** `staff`: values staff set don't cost PTP. */
export function ptp(sheet: Sheet, bonusPtp = 0, staff: StaffOverrides = {}) {
	const entries = sheet.systems.map((e) => ({ e, def: systemById.get(e.system) }));
	const ghoul = entries.map(({ e, def }) => def?.baseStats?.(e.fields)).find(Boolean) ?? null;
	const role = rules.roles.find((r) => r.id === sheet.role);
	const traitRules = traitStarts(sheet);
	const noPtp = Boolean(ghoul?.noPtp) || traitRules.some((t) => t.noStartingPtp);

	const start = noPtp ? 0 : role?.startingPtp ?? 0;
	const bonus = noPtp ? 0 : entries.reduce((sum, { e, def }) => sum + (def?.ptpBonus?.(e.fields) ?? 0), 0);
	const traitBonus = noPtp ? 0 : traitRules.reduce((sum, t) => sum + (t.ptp ?? 0), 0);
	const granted = Math.max(0, bonusPtp);
	const available = Math.max(0, start + bonus + traitBonus) + granted;

	let spent = 0;
	for (const stat of ['strength', 'speed', 'defense', 'stamina'] as const) {
		const value = rankValue(sheet.stats[stat]);
		if (value !== undefined && !staff[`stats.${stat}`]) spent += Math.max(0, value - statStart(sheet, stat));
	}
	// Intelligence costs (or refunds) PTP relative to where it starts: Average, unless a trait says otherwise.
	const intelPtp = (v: string) => rules.stats.intelligence.find((i) => i.value === v)?.ptp ?? 0;
	const heavenly = sheetHeavenly(sheet);
	const intelBase = heavenly?.baseIntelligence ?? traitRules.find((t) => t.baseIntelligence)?.baseIntelligence ?? 'Average';
	if (!staff['stats.intelligence']) spent += intelPtp(sheet.stats.intelligence) - intelPtp(intelBase);
	// Hops up to the phase a Heavenly Restriction puts you in are free.
	const freePhase = staff['stats.phase'] ? Infinity : (heavenly?.phase ?? 0);
	spent += rules.stats.phases.filter((p) => p.phase <= sheet.stats.phase && p.phase > freePhase).reduce((sum, p) => sum + p.hopCost, 0);
	return { spent, available, start, bonus, traitBonus, granted, noPtp, roleKnown: Boolean(role) };
}

/** How many of one power system a character may have: Abilities and Quirks are unlimited,
 * the rest one each unless a trait or discovered combination raises it. */
export function systemLimit(sheet: Sheet, systemId: string, comboLimits: Record<string, number>[] = []): number {
	if (rules.powerSets.unlimited.includes(systemId)) return Infinity;
	let limit = 1;
	for (const t of rules.powerSets.traitLimits) {
		const limits = t.limits as Record<string, number>;
		if (sheet.traits.some((p) => p.name === t.trait)) limit = Math.max(limit, limits[systemId] ?? 1);
	}
	for (const c of comboLimits) limit = Math.max(limit, c[systemId] ?? 1);
	return limit;
}

/** Fewest skills a new card needs: one less than the starting maximum. */
export const minimumMoves = (max: number | undefined) => (max === undefined ? 0 : Math.max(0, max - 1));

const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' ? v.trim() === '' : Array.isArray(v) && v.length === 0);
const isLink = (v: string) => /^https?:\/\/\S+$/i.test(v.trim());

/** The start of the permission item an encryption request makes; approving it encrypts the character. */
export const ENCRYPTION_ITEM = 'Encryption 🔒 needs permission';

export function checkSheet(sheet: Sheet, given: CheckContext): Issue[] {
	// A character staff marked as progressed is checked like an evolution: no starting limits.
	const ctx = given.progressed ? { ...given, isEvolution: true } : given;
	const staff = (path: string) => Boolean(ctx.staffOverrides?.[path]);
	const issues: Issue[] = [];
	const add = (level: IssueLevel, section: string, message: string, card?: string) => issues.push(card ? { level, section, message, card } : { level, section, message });
	const oc = ctx.kind === 'oc';

	// ── Basics ──
	if (blank(ctx.name)) add('error', 'Basics', 'Give your character a name.');
	if (!oc && blank(ctx.canonUniverse)) add('error', 'Basics', 'Pick which series your canon character is from.');
	if (ctx.encryptionRequest) {
		if (blank(ctx.encryptionRequest.reason)) add('error', 'Basics', 'Say why you want this character encrypted.');
		else add('permission', 'Basics', `${ENCRYPTION_ITEM}: ${ctx.encryptionRequest.reason.trim()}`);
	}
	if (ctx.adminCharacter) return issues; // admin characters skip every rule
	if (oc && blank(sheet.role)) add('error', 'Basics', 'Pick a role.');

	// ── Appearance & lore ──
	if (!blank(sheet.appearance.image) && !isLink(sheet.appearance.image)) add('warning', 'Appearance', 'The main picture should be a link starting with https://');
	if (oc) {
		if (blank(sheet.appearance.description)) add('error', 'Appearance', 'Describe what your character looks like.');
		if (blank(sheet.lore.backstory)) add('error', 'Lore', 'Write your character’s backstory.');
		if (blank(sheet.lore.personality)) add('error', 'Lore', 'Describe your character’s personality.');
	} else {
		if (blank(sheet.canon.portrayal)) add('error', 'Tryout', 'Explain how you’ll portray this character.');
		if (blank(sheet.canon.sample)) add('error', 'Tryout', 'Add a short roleplay sample.');
	}
	// Canon tryouts use the lighter sheet. Once approved, a canon can add any system and evolve.
	if (!oc && !ctx.isEvolution) return issues;

	// ── S.T.S stats ──
	const s = sheet.stats;
	for (const stat of ['strength', 'speed', 'defense', 'stamina'] as const) {
		if (oc && blank(s[stat])) add('error', 'Stats', `Pick a rank for ${stat[0].toUpperCase() + stat.slice(1)}.`);
	}
	const phase = rules.stats.phases.find((p) => p.phase === s.phase);
	for (const stat of ['strength', 'speed', 'defense', 'stamina'] as const) {
		const info = rankInfo(s[stat]);
		// A rank a trait or system starts the stat at is never a problem.
		if (info && phase && info.tier > phase.maxTier && info.value > statStart(sheet, stat) && !staff(`stats.${stat}`)) {
			add('warning', 'Stats', `${stat[0].toUpperCase() + stat.slice(1)} (${info.rank}) is above ${phase.label} (up to Tier ${phase.maxTier}).`);
		}
	}
	const r = recoil(sheet);
	if (r) add('warning', 'Stats', `Recoil Lv ${r.level}: ${r.high} is ${r.gap} Sub-Tiers above ${r.low} (more than ${r.freeGap} apart).`);

	const potential = rules.potentials.find((p) => p.id === sheet.potential.grade);
	if (!potential) {
		if (oc && !staff('potential.grade')) add('error', 'Traits', 'Roll your Potential.');
	}
	else {
		if ('rolled' in potential && potential.rolled) add('permission', 'Traits', `${potential.label} Potential is rolled by staff.`);
		if (s.phase > potential.maxPhase && !staff('stats.phase') && !staff('potential.grade')) add('warning', 'Stats', `${potential.label} Potential can’t reach Phase ${s.phase} (max Phase ${potential.maxPhase}).`);
		for (const stat of ['strength', 'speed', 'defense', 'stamina'] as const) {
			const info = rankInfo(s[stat]);
			if (info && info.tier > potential.maxTier && info.value > statStart(sheet, stat) && !staff(`stats.${stat}`) && !staff('potential.grade')) add('warning', 'Stats', `${potential.label} Potential stops at Tier ${potential.maxTier}, but ${stat} is ${info.rank}.`);
		}
	}
	// The Divine S.T.S (past 20A) needs Divine Potential, which only staff give.
	const divineStats = (['strength', 'speed', 'defense', 'stamina'] as const).filter((k) => (rankInfo(s[k])?.tier ?? 0) > 20 && !staff(`stats.${k}`));
	if (sheet.potential.grade !== 'divine' && !staff('potential.grade')) {
		if (divineStats.length) add('error', 'Stats', `The Divine S.T.S (${divineStats.join(', ')}) needs Divine Potential.`);
		if (s.phase >= DIVINE_PHASE && !staff('stats.phase')) add('error', 'Stats', 'Phase 4: Divine needs Divine Potential.');
	}
	const intel = rules.stats.intelligence.find((i) => i.value === s.intelligence);
	if (intel && 'permission' in intel && intel.permission) add('permission', 'Stats', `${intel.value} Intelligence needs permission.`);

	if (!ctx.isEvolution) {
		const budget = ptp(sheet, ctx.bonusPtp, ctx.staffOverrides);
		if (budget.roleKnown && budget.spent > budget.available) {
			const granted = budget.granted ? `${budget.granted} granted by staff` : '';
			const parts = budget.noPtp
				? granted || 'none, because of a trait or system that blocks starting PTP'
				: `${budget.start} from your role, ${budget.bonus} from systems, ${budget.traitBonus} from traits${granted && `, ${granted}`}`;
			add('error', 'Stats', `You’re spending ${budget.spent} PTP, but you start with ${budget.available} (${parts}).`);
		}
	}

	// ── Traits ──
	const slots = traitSlots(sheet, ctx.extraTraitSlots ?? 0);
	if (slots.used > slots.total) add('error', 'Traits', `Your traits take ${slots.used} slots, but you only have ${slots.total}. Remove a trait.`);
	// Traits a family's Inheritance gives don't count toward the one Family trait.
	const inherited = ctx.inheritedPerks ?? new Set<string>();
	if (sheet.traits.filter((t) => t.family && !(t.perkId && inherited.has(t.perkId))).length > rules.traitSlots.familyTrait.max) add('error', 'Traits', 'Only one trait can be a Family trait.');
	const inFamily = (ctx.families?.length ?? 0) > 0;
	if (sheet.traits.some((t) => t.family) && !inFamily) add('error', 'Families', 'A Family trait needs a family: pick the family that offers it.');
	const seen = new Set<string>();
	for (const picked of sheet.traits) {
		// A linked family trait may be the family's own custom trait; checkFamilyTrait checks the link.
		if (!traitByName.has(picked.name) && !(picked.family && picked.perkId)) add('error', 'Traits', `“${picked.name}” isn’t a known trait.`);
		if (seen.has(picked.name)) add('error', 'Traits', `“${picked.name}” is picked twice.`);
		seen.add(picked.name);
		if (picked.family) checkFamilyTrait(picked, ctx, add);
	}

	// ── Combat ──
	for (const style of sheet.combat.styles) {
		if (blank(style.name)) add('error', 'Combat', 'A Fighting Style is missing its name.');
	}

	// ── Systems ──
	checkSystems(sheet, ctx, add);

	// ── Canon claims ──
	// One canon ability per series at a time (e.g. one canon Quirk).
	const perSeries = new Map<string, string[]>();
	for (const id of ctx.requestedClaims ?? []) {
		const claim = ctx.claims?.get(id);
		if (claim?.universe && claim.claimType === 'ability') perSeries.set(claim.universe, [...(perSeries.get(claim.universe) ?? []), claim.name]);
	}
	for (const names of perSeries.values()) {
		if (names.length > 1) add('error', 'Systems', `Only one canon ability per series at a time: pick one of ${names.join(', ')}.`);
	}
	for (const id of ctx.requestedClaims ?? []) {
		const claim = ctx.claims?.get(id);
		if (!claim) add('error', 'Systems', 'A picked canon claim no longer exists.');
		else if (!ctx.heldClaimIds?.has(id) && claim.maxUsers !== null && claim.usedSlots >= claim.maxUsers) {
			add('error', 'Systems', claim.claimType === 'ocular' ? 'All Ocular Spots are taken: remove your Ocular.' : `${claim.name} is already full (${claim.usedSlots}/${claim.maxUsers}).`);
		}
		// The card holding the canon ability: the one it was picked on.
		const holder = claim?.claimType === 'ability' ? canonHolder(sheet.systems, claim.universe, id) : undefined;
		// A canon Quirk's class and Quirk Factor are fixed.
		const q = claim?.universe === 'my-hero-academia' && claim.claimType === 'ability' ? canonQuirk(claim.name) : undefined;
		const card = q ? holder : undefined;
		if (q && card) {
			if (card.fields.type !== q.class) add('error', 'Systems', `${claim!.name} is a canon ${q.class} Quirk: set its class back.`);
			if (q.factor && String(card.fields.factor ?? '') !== q.factor) add('error', 'Systems', `${claim!.name}’s Quirk Factor is ${q.factor}: set it back.`);
		}
		// A canon Ignition (a Pillar's) fixes its Adolla Burst, and its Generation when that's listed.
		const ig = claim?.universe === 'fire-force' && claim.claimType === 'ability' ? canonIgnition(claim) : {};
		const fire = Object.keys(ig).length ? holder : undefined;
		if (fire) {
			for (const [k, v] of Object.entries(ig)) {
				if (String(fire.fields[k] ?? '') !== String(v))
					add(
						'error',
						'Systems',
						k === 'adollaBurst'
							? `${claim!.name} is a Pillar’s Ignition, so the card has an Adolla Burst: set it back.`
							: k === 'theme'
								? `${claim!.name} follows its canon theme: set it back.`
								: `${claim!.name} is a ${String(v)} Generation Ignition: set it back.`,
					);
			}
		}
		// A canon Conduit keeps its class and element.
		const cond = claim?.universe === 'infamous' && claim.claimType === 'ability' ? canonConduitFields(claim.name) : {};
		const conduit = Object.keys(cond).length ? holder : undefined;
		if (conduit && Object.entries(cond).some(([k, v]) => String(conduit.fields[k] ?? '') !== String(v)))
			add('error', 'Systems', `${claim!.name} is a canon ${String(cond.class)} Conduit${cond.element ? ` (${String(cond.element)})` : ''}: set it back.`);
		// A canon Stand keeps its canon stats.
		const stand = claim?.universe === 'jojo' && claim.claimType === 'ability' ? canonStandFields(claim.name) : {};
		const jojo = Object.keys(stand).length ? holder : undefined;
		if (jojo) {
			const off = Object.entries(stand).filter(([k, v]) => String(jojo.fields[k] ?? '') !== String(v));
			if (off.length || jojo.fields.canonStand !== claim!.name) add('error', 'Systems', `${claim!.name} keeps its canon stats: pick it again to set them back.`);
		}
		// An Ocular spot: the JJK card says which eye and what it does, and staff approve it.
		if (claim?.claimType === 'ocular') {
			// The card describing the Ocular, or the first Jujutsu Kaisen card (as the form shows it).
			const jjk = sheet.systems.filter((e) => e.system === 'jujutsu-kaisen' && !e.familyLink && !e.powerLink);
			const card = jjk.find((e) => ['ocular', 'ocularImage', 'ocularAbility'].some((k) => String(e.fields[k] ?? '').trim())) ?? jjk[0];
			if (!card) add('error', 'Systems', 'An Ocular needs a Jujutsu Kaisen card: add one, or remove the Ocular.');
			else {
				const name = String(card.fields.ocular ?? '').trim();
				const does = String(card.fields.ocularAbility ?? '').trim();
				if (!name) add('error', 'Systems', 'Oculars: name your Ocular.', card.key);
				if (!does) add('error', 'Systems', 'Oculars: say what your Ocular does.', card.key);
				if (name && does) add('permission', 'Systems', `Ocular Jujutsu Organ: ${name}: “${does}”`, card.key);
			}
		}
		if (claim && rules.permissionClaimCategories.includes(claim.category ?? '')) {
			add(
				'permission',
				inFamily ? 'Families' : 'Systems',
				inFamily
					? `${claim.name} is ${claim.category}: the family that holds it (or an admin) confirms it.`
					: `${claim.name} is ${claim.category}: only the family that holds it can give it, through the family’s Inheritance.`,
			);
		}
	}

	return issues;
}

function checkSystems(sheet: Sheet, ctx: CheckContext, add: (level: IssueLevel, section: string, message: string, card?: string) => void) {
	const staff = (path: string) => Boolean(ctx.staffOverrides?.[path]);
	const entries = sheet.systems;
	if (entries.length > 1 && !entries.some((e) => e.key === sheet.prioritySystem)) {
		add('error', 'Systems', 'With more than one power system, pick your priority system.');
	}
	checkHeavenly(sheet, ctx, add, staff);
	const counts = new Map<string, number>();
	for (const e of entries) {
		// A power an admin granted is on top of the usual limit.
		if (!e.powerLink && !e.mafoGift && countsTowardLimit(systemById.get(e.system), e.fields)) counts.set(e.system, (counts.get(e.system) ?? 0) + 1);
	}
	for (const [system, count] of counts) {
		const limit = systemLimit(sheet, system, ctx.comboSystemLimits);
		if (count > limit) {
			const def = systemById.get(system);
			const what = def?.limitedChoice ? def.limitedChoice.label : `${def?.label ?? system} power set`;
			add('error', 'Systems', `You can only have ${limit === 1 ? 'one' : limit} ${what}${limit === 1 ? '' : 's'}, but you have ${count}.`);
		}
	}
	for (const entry of entries) {
		const addHere = (level: IssueLevel, section: string, message: string) => add(level, section, message, entry.key);
		const def = systemById.get(entry.system);
		if (!def) {
			addHere('error', 'Systems', `Unknown power system “${entry.system}”.`);
			continue;
		}
		const link = entry.familyLink;
		if (entry.powerLink) {
			// A granted power is the admin's design: check the grant, not the build.
			checkPowerLink(entry, ctx, `${def.label} (${entry.powerLink.title})`, addHere);
			// A skill with its own scaling can need a trait.
			for (const m of missingTraits(entry.skills, sheet.traits.map((t) => t.name))) addHere('error', 'Systems', `${def.label} (${entry.powerLink.title}): “${m.skill}” needs the ${m.trait} trait.`);
			continue;
		}
		const where = link ? `${def.label} (${link.title})` : def.label;
		if (entry.customTree) {
			for (const problem of treeProblems(entry.customTree, entry)) addHere('error', 'Systems', `${where}: ${problem}`);
			const approved = ctx.approvedSheet?.systems.find((e) => e.key === entry.key)?.customTree;
			if (currencyChanged(entry.customTree, approved)) {
				const c = entry.customTree.custom;
				const conversion = c.convertFrom ? `, ${c.convertFromAmount} ${c.convertFrom} → ${c.convertToAmount} ${c.code}` : '';
				addHere('permission', 'Systems', `${where}: custom currency “${c.name}” (+${c.gain} ${c.code} per session${conversion}) needs its rates approved.`);
			}
		}
		if (link) {
			// A linked card is the family's approved ability: check the link, not the build.
			checkFamilyLink(entry, ctx, where, add);
			continue;
		}
		const allowed = def.onlyWith?.(entry.fields);
		if (allowed) {
			for (const other of entries) {
				if (other !== entry && !allowed.includes(other.system)) {
					addHere('error', 'Systems', `${where} can’t be combined with ${systemById.get(other.system)?.label ?? other.system}.`);
				}
			}
		}
		// Rolled fields come from one roll: report a missing roll once, not once per field.
		const missingRolls = new Set<string>();
		// Fields a Heavenly Restriction sets are checked with it (checkHeavenly).
		const heavenlyFixed = entry.system === 'jujutsu-kaisen' ? (sheetHeavenly(sheet)?.fixed ?? {}) : {};
		for (const field of visibleFields(def, entry.fields)) {
			if (field.key in heavenlyFixed || staff(cardPath(entry.key, field.key))) continue;
			if (field.rolled && field.required && blank(entry.fields[field.key])) {
				if (!missingRolls.has(field.rolled)) addHere('error', 'Systems', `${where}: roll your ${field.label}.`);
				missingRolls.add(field.rolled);
				continue;
			}
			checkField(field, entry.fields[field.key], where, add, sheet.traits.map((t) => t.name));
		}
		// A card marked as a canon Stand needs that Stand claimed (its stats skip the starting points).
		if (entry.system === 'jojo' && entry.fields.canonStand) {
			const named = String(entry.fields.canonStand);
			const claimed = (ctx.requestedClaims ?? []).some((id) => ctx.claims?.get(id)?.universe === 'jojo' && ctx.claims?.get(id)?.name === named);
			if (!claimed && ctx.claims) addHere('error', 'Systems', `${where}: ${named} isn’t claimed. Claim it again, or set your own Stand stats.`);
		}
		// A new character starts at set stats and points; going past them needs a stat override staff approve.
		if (!ctx.isEvolution) {
			const fixed = entry.system === 'jujutsu-kaisen' ? (sheetHeavenly(sheet)?.fixed ?? {}) : {};
			const past = visibleFields(def, entry.fields).filter((f) => !(f.key in fixed) && !staff(cardPath(entry.key, f.key)) && pastStart(f, entry.fields[f.key]));
			const budget = systemBudget(sheet, entry);
			const over = budget && budget.spent > budget.total ? budget : null;
			const ask = entry.statOverride?.ask?.trim() ?? '';
			const asked = [...past.map((f) => `${f.label} ${entry.fields[f.key]}`), ...(over ? [`${over.spent} ${over.label} (starts with ${over.total})`] : []), ...(ask ? [ask] : [])];
			if (entry.statOverride) {
				if (!asked.length) addHere('warning', 'Systems', `${where}: your stat override doesn't ask for anything yet. Pick the stats you want, or remove the request.`);
				else if (blank(entry.statOverride.reason)) addHere('error', 'Systems', `${where}: explain why you're asking for a stat override.`);
				else addHere('permission', 'Systems', `${where}: stat override (${asked.join(', ')}): “${entry.statOverride.reason.trim()}”`);
			} else {
				for (const f of past) addHere('error', 'Systems', `${where}: ${f.label} starts at ${startText(f)}. Ask for a stat override to start higher.`);
				if (over) addHere('error', 'Systems', `${where}: ${over.spent} ${over.label} spent, but you start with ${over.total}. Ask for a stat override to start higher.`);
			}
		}
		for (const extra of def.checks?.(entry.fields, !ctx.isEvolution) ?? []) addHere(extra.level, 'Systems', extra.message);
		const moves = def.startingMoves?.(entry.fields);
		for (const type of ['standard', 'ultimate'] as const) {
			const max = moves?.[type];
			if (max === undefined) continue;
			const name = type === 'standard' ? moves?.label ?? 'Standard skill' : moves?.ultimateLabel ?? 'Ultimate skill';
			const count = entry.skills.filter((sk) => sk.type === type && !sk.locked).length;
			const min = minimumMoves(max);
			if (count < min) addHere('error', 'Systems', `${where}: add at least ${min} ${name}${min === 1 ? '' : 's'} (you have ${count}).`);
			else if (!ctx.isEvolution && count > max) addHere('warning', 'Systems', `${where}: ${count} ${name}s, but you can start with ${max}.`);
		}
		// e.g. a Cursed Technique has a single Maximum Technique.
		const ultimates = entry.skills.filter((sk) => sk.type === 'ultimate' && !sk.locked).length;
		if (moves?.ultimateCap !== undefined && ultimates > moves.ultimateCap) {
			const name = moves.ultimateLabel ?? 'Ultimate skill';
			addHere('error', 'Systems', `${where}: only ${moves.ultimateCap} ${name}${moves.ultimateCap === 1 ? '' : 's'} allowed (you have ${ultimates}).`);
		}
		const approvedCard = ctx.approvedSheet?.systems.find((e) => e.key === entry.key)?.fields;
		if (entry.system === 'jujutsu-kaisen' && !barrierUnlocked(sheet, entry, { progressed: ctx.progressed, staffOverrides: ctx.staffOverrides, approvedFields: approvedCard })) {
			const used = def.fields.filter((x) => BARRIER_KEYS.includes(x.key) && barrierUsed(x, entry.fields[x.key]));
			if (!used.length) {
				// nothing to check
			} else if (entry.statOverride && !ctx.isEvolution) {
				const why = entry.statOverride.barrier?.trim() ?? '';
				if (!why) addHere('error', 'Systems', `${where}: say why you should start with Barrier Techniques (Barrier Techniques tab).`);
				else addHere('permission', 'Systems', `${where}: Barrier Techniques at the start: “${why}”`);
			} else addHere('error', 'Systems', `${where}: Barrier Techniques are locked. They need the Barrier Prodigy trait, a family ability or staff.`);
		}
		// Cyberware is obtained in RP: it opens once the character is approved (or staff unlock it).
		if (entry.system === 'cyberpunk' && !ctx.isEvolution && !ctx.progressed && !staff(cardPath(entry.key, 'cyberware')) && Array.isArray(entry.fields.cyberware) && entry.fields.cyberware.length)
			addHere('error', 'Systems', `${where}: Cyberware is locked until your character is approved. Staff can unlock it for you.`);
		const approvedFields = ctx.approvedSheet?.systems.find((e) => e.key === entry.key)?.fields;
		// Fear Points are earned in RP: a new Devil starts without them; after approval staff check the gains and any Metamorphosis.
		if (entry.system === 'chainsaw-man') {
			const fp = (fl: Fields | undefined, k: string) => Number(fl?.[k] ?? 0) || 0;
			if (!ctx.isEvolution && !ctx.progressed) {
				const used = FEAR_KEYS.some((k) => fp(entry.fields, k) > 0 && !staff(cardPath(entry.key, k)));
				if (used) addHere('error', 'Systems', `${where}: Fear Points and their upgrades come after approval. Staff can set them for you.`);
			} else if (approvedFields) {
				const gained = fp(entry.fields, 'fearPoints') - fp(approvedFields, 'fearPoints');
				if (fp(entry.fields, 'tankUpgrades') >= TANK_MAX && fp(approvedFields, 'tankUpgrades') < TANK_MAX && !staff(cardPath(entry.key, 'tankUpgrades')))
					addHere('permission', 'Systems', `${where}: Blood Tank Max; the Index lists no Fear Point cost for it, so staff confirm it.`);
				if (gained > 0) addHere('permission', 'Systems', `${where}: +${gained} Fear Points earned; staff check how they were earned.`);
				const was = DEVIL_CLASSES.findIndex((c) => c.id === approvedFields.devilClass);
				const now = DEVIL_CLASSES.findIndex((c) => c.id === entry.fields.devilClass);
				if (was >= 0 && now !== was && !staff(cardPath(entry.key, 'devilClass'))) {
					if (entry.fields.path !== 'Devil') addHere('error', 'Systems', `${where}: only Devils can Metamorphose; a ${String(entry.fields.path)}'s class stays the same.`);
					else if (now === was + 1) addHere('permission', 'Systems', `${where}: Metamorphosis to ${DEVIL_CLASSES[now].id}; a GM runs it (3 real-life days) and sets the new physical stats.`);
					else addHere('error', 'Systems', `${where}: Metamorphosis moves a Devil up one class at a time.`);
				}
			}
		}
		// Pyrokinetic Techniques are taught in RP; Tephrosis only gets worse, and Adaptation needs its trait.
		if (entry.system === 'fire-force') {
			const taught = (fl: Fields | undefined) => (Array.isArray(fl?.techniques) ? (fl!.techniques as string[]) : []);
			if (!ctx.isEvolution && !ctx.progressed) {
				if (taught(entry.fields).length && !staff(cardPath(entry.key, 'techniques')))
					addHere('error', 'Systems', `${where}: Pyrokinetic Techniques are taught in RP, so they open once you’re approved. Staff can unlock them for you.`);
			} else if (approvedFields) {
				for (const t of taught(entry.fields).filter((t) => !taught(approvedFields).includes(t))) {
					const from = techniqueLog(entry.fields).find((e) => e.technique === t)?.teacher;
					addHere('permission', 'Systems', `${where}: learned ${t}${from ? ` from ${from}` : ''}; staff confirm it was taught in RP.`);
				}
				const points = pointsOf(entry.fields);
				for (const [key, name] of [['breathLevel', 'Breath of Life'], ['pressLevel', 'Press of Death']] as const) {
					const was = Number(approvedFields[key] ?? 0) || 0;
					const now = Number(entry.fields[key] ?? 0) || 0;
					if (now > was) {
						const cost = TECHNIQUE_COST.slice(was + 1, now + 1).reduce((n, c) => n + c, 0);
						addHere('permission', 'Systems', `${where}: ${name} Level ${now} (${cost} ${points}); staff check the points.`);
					}
				}
				const stage = (fl: Fields) => TEPHROSIS.findIndex((t) => t.id === fl.tephrosis);
				if (stage(entry.fields) < stage(approvedFields) && !staff(cardPath(entry.key, 'tephrosis')))
					addHere('error', 'Systems', `${where}: Tephrosis can’t be stopped or cured.`);
			}
			if (entry.fields.tephrosis === 'Adaptation' && !sheet.traits.some((t) => t.name === ADAPTATION_TRAIT))
				addHere('error', 'Systems', `${where}: Tephrosis Adaptation needs the ${ADAPTATION_TRAIT} trait.`);
		}
		// JoJo: Hamon and Spin upgrades come from points after approval; a Stand can come later from an Arrow.
		if (entry.system === 'jojo') {
			const tracks = [...HAMON_TRACKS, ...SPIN_TRACKS];
			if (!ctx.isEvolution && !ctx.progressed) {
				const used = tracks.filter((t) => trackLevel(t, entry.fields) > 0 && !staff(cardPath(entry.key, t.key)));
				if (used.length) addHere('error', 'Systems', `${where}: ${used.map((t) => t.label).join(', ')} upgrades come after approval.`);
			} else if (approvedFields) {
				for (const t of tracks) {
					const was = trackLevel(t, approvedFields);
					const now = trackLevel(t, entry.fields);
					const code = HAMON_TRACKS.includes(t) ? 'HUP' : 'SUP';
					if (now > was) addHere('permission', 'Systems', `${where}: ${t.label} upgrade ${now === t.steps.length ? 'Max' : now}; staff check the ${code}.`);
				}
				if (hasStand(entry.fields) && !hasStand(approvedFields)) addHere('permission', 'Systems', `${where}: gained a Stand; staff confirm the Stand Arrow and the GMs’ survival roll.`);
			}
			if (entry.fields.standEvolution === 'ACT' && sheet.potential.grade !== 'low') addHere('error', 'Systems', `${where}: ACT Stands are for Low Potential only.`);
		}
		// Tokyo Ghoul: GEP, Rc Tank upgrades and M-Rc are earned in RP; after approval staff check them.
		if (entry.system === 'tokyo-ghoul') {
			const n = (fl: Fields | undefined, k: string) => Number(fl?.[k] ?? 0) || 0;
			if (!ctx.isEvolution && !ctx.progressed) {
				const used = (['gep', 'tankUpgrades', 'mutatedRc'] as const).filter((k) => n(entry.fields, k) > 0 && !staff(cardPath(entry.key, k)));
				if (used.length) addHere('error', 'Systems', `${where}: GEP, Rc Tank upgrades and M-Rc come after approval. Staff can set them for you.`);
			} else if (approvedFields) {
				const gep = n(entry.fields, 'gep') - n(approvedFields, 'gep');
				if (gep > 0) addHere('permission', 'Systems', `${where}: +${gep} GEP earned; staff check how.`);
				const up = n(entry.fields, 'tankUpgrades');
				if (up > n(approvedFields, 'tankUpgrades')) addHere('permission', 'Systems', `${where}: Rc Tank upgrade ${up}; staff check the GEP.`);
				const mrc = n(entry.fields, 'mutatedRc') - n(approvedFields, 'mutatedRc');
				if (mrc > 0) addHere('permission', 'Systems', `${where}: +${mrc} M-Rc; staff check the Ghouls eaten.`);
				const frames = (fl: Fields) => Number(fl.quinxFrames ?? 5);
				if (entry.fields.quinx === 'Yes' && approvedFields.quinx === 'Yes' && frames(entry.fields) < frames(approvedFields))
					addHere('permission', 'Systems', `${where}: Quinx frame removed (${frames(entry.fields)} left); staff confirm the promotion.`);
			}
			if (entry.fields.kakuja === 'Incomplete Kakuja' && !sheet.traits.some((t) => t.name === AFFINITY_TRAIT))
				addHere('warning', 'Systems', `${where}: as an Incomplete Kakuja without ${AFFINITY_TRAIT}, you lose all reason while it’s deployed.`);
		}
		// inFAMOUS: evolution items come from Arc Rolls and Karma from RP; upgrades are bought with items after approval.
		if (entry.system === 'infamous') {
			// Psychics: Mental Domination happens in RP; Bio-Conduits and lower-phase Psychics only fall to Phase X.
			const puppets = puppetsOf(entry.fields);
			if (puppets.length && entry.fields.class !== 'Psychic') addHere('error', 'Systems', `${where}: only Psychic Conduits keep others under their influence.`);
			if (puppets.length && !ctx.isEvolution && !ctx.progressed && !staff(cardPath(entry.key, 'puppets')))
				addHere('error', 'Systems', `${where}: Mental Domination happens in RP, so the people under your influence come after approval.`);
			puppets.forEach((p, i) => {
				const who = p.name?.trim() || `Puppet #${i + 1}`;
				if (!p.name?.trim()) addHere('error', 'Systems', `${where}: say who Puppet #${i + 1} is.`);
				if (p.target && p.target !== PUPPET_TARGETS[0] && String(entry.fields.psychicPhase ?? '5') !== 'X')
					addHere('error', 'Systems', `${where}: only a Phase X Psychic can take over ${p.target === PUPPET_TARGETS[1] ? 'a Bio-Enhanced Conduit' : 'a lower-phase Psychic'} (${who}).`);
			});
			if (approvedFields) {
				const before = new Set(puppetsOf(approvedFields).map((p) => p.name?.trim().toLowerCase()));
				const added = puppets.filter((p) => p.name?.trim() && !before.has(p.name.trim().toLowerCase()));
				if (added.length) addHere('permission', 'Systems', `${where}: now controls ${added.map((p) => `${p.name.trim()} (${p.kind || 'OC'})`).join(', ')}; staff check the takeover.`);
			}
			const n = (fl: Fields | undefined, k: string) => Number(fl?.[k] ?? 0) || 0;
			const earned = [...ITEMS.map((i) => i.key), 'karmaPoints'];
			if (!ctx.isEvolution && !ctx.progressed) {
				if (earned.some((k) => n(entry.fields, k) > 0 && !staff(cardPath(entry.key, k))))
					addHere('error', 'Systems', `${where}: evolution items and Karma come after approval. Staff can set them for you.`);
			} else if (approvedFields) {
				for (const item of ITEMS) {
					const got = n(entry.fields, item.key) - n(approvedFields, item.key);
					if (got > 0) addHere('permission', 'Systems', `${where}: +${got} ${item.label}; staff check the Arc Rolls.`);
				}
				const karma = n(entry.fields, 'karmaPoints') - n(approvedFields, 'karmaPoints');
				if (karma !== 0) addHere('permission', 'Systems', `${where}: Karma ${karma > 0 ? '+' : ''}${karma}; staff check the acts.`);
				if (approvedFields.karma && approvedFields.karma !== 'Neutral' && entry.fields.karma !== approvedFields.karma && !staff(cardPath(entry.key, 'karma')))
					addHere('permission', 'Systems', `${where}: Karma path changed to ${String(entry.fields.karma)}; staff confirm it.`);
				const levels = CONDUIT_FIELDS.filter((x) => x.type === 'select' || ['chargeUpgrades', 'bioShardNode', 'bioCoreNode', 'bioRelayNode'].includes(x.key));
				const up = levels.filter((x) => String(entry.fields[x.key] ?? x.default ?? '') !== String(approvedFields[x.key] ?? x.default ?? '') && !staff(cardPath(entry.key, x.key)));
				if (up.length) addHere('permission', 'Systems', `${where}: ${up.map((x) => x.label).join(', ')} upgraded; staff check the evolution items spent.`);
			}
		}
		// What the system grows into (e.g. Quirk Awakenings): locked for new characters, and checked against its requirements after.
		const defaults: Fields = Object.fromEntries(def.fields.map((x) => [x.key, x.default]));
		// A claimed canon Ignition brings what it fixes (a Pillar's Adolla Burst): its claim is the permission.
		const fire = entry.system === 'fire-force' ? fireClaim(ctx) : undefined;
		const fixedByClaim = fire && canonHolder(sheet.systems, 'fire-force', fire.id)?.key === entry.key ? fire.fixed : {};
		for (const p of potentialsFor(entry.system)) {
			if (p.keys.some((k) => staff(cardPath(entry.key, k)) || k in fixedByClaim)) continue;
			const evolving = ctx.isEvolution || ctx.progressed;
			if (!potentialChanged(p, entry.fields, defaults, evolving ? approvedFields : undefined)) continue;
			if (!evolving) {
				const reqs = p.requirements(entry.fields, potentialCtxOf(sheet, ctx.combos));
				const blocked = reqs.filter((r) => r.status === 'unmet' && r.blocksStart);
				// A trait or Combo trait that lets a character start with it (Stand Prodigy, Spinning Soul).
				if (!blocked.length && reqs.some((r) => r.status === 'met' && r.grantsStart)) continue;
				if (p.startPermission) {
					if (blocked.length) addHere('error', 'Systems', `${where}: ${p.label} needs ${blocked.map((r) => r.label).join(', ')}.`);
					else if (p.reached(entry.fields) && !reqs.some((r) => r.status === 'met' && r.grantsStart)) addHere('permission', 'Systems', `${where}: starting with ${p.label} needs permission.`);
				} else addHere('error', 'Systems', `${where}: ${p.label} is locked. New characters start without it; staff can unlock it.`);
				continue;
			}
			const before = approvedFields ?? defaults;
			const gained = (key: string | undefined) => (key ? Number(entry.fields[key] ?? 0) - Number(before[key] ?? 0) : 0);
			// Repeating ones (Awakenings) need the requirements for each new one not given by a roll.
			const needsReqs = p.count !== undefined ? gained(p.count) > gained(p.rolledCount) : !p.reached(before);
			const unmet = needsReqs ? p.requirements(entry.fields, potentialCtxOf(sheet, ctx.combos)).filter((r) => r.status === 'unmet' && !r.startOnly) : [];
			if (unmet.length) addHere('error', 'Systems', `${where}: ${p.label} needs ${unmet.map((r) => r.label).join(', ')} first.`);
			else addHere('permission', 'Systems', `${where}: ${p.label} changed; ${p.confirm}`);
		}
		// Skills locked on the approved tree open only by unlocking them with points.
		const approvedSkills = ctx.approvedSheet?.systems.find((e) => e.key === entry.key)?.skills ?? [];
		for (const skill of entry.skills) {
			if (!skill.locked && skill.treeNodeId && approvedSkills.some((a) => a.treeNodeId === skill.treeNodeId && a.locked))
				addHere('error', 'Systems', `${where}: unlock “${skill.name || 'unnamed'}” on the skill tree with points instead.`);
		}
		for (const skill of entry.skills) {
			if (blank(skill.name)) addHere('error', 'Systems', `${where}: a skill is missing its name.`);
			if (skill.type === 'passive') addHere('permission', 'Systems', `${where}: custom passive “${skill.name || 'unnamed'}” needs permission.`);
		}
	}
}

function checkPowerLink(entry: SystemEntry, ctx: CheckContext, where: string, add: (level: IssueLevel, section: string, message: string) => void) {
	const link = entry.powerLink!;
	if (!ctx.powerGrants || link.grantId === null) return;
	const grant = ctx.powerGrants.find((g) => g.id === link.grantId);
	if (!grant || grant.power_id !== link.powerId) {
		add('error', 'Systems', `${where}: this power isn’t granted to this player any more. Remove the card.`);
		return;
	}
	if (grant.character_id && grant.character_id !== ctx.characterId) add('error', 'Systems', `${where}: this grant is already used by another character.`);
	if (powerCardChanged(entry, grant.power)) add('warning', 'Systems', `${where}: an admin has changed this power since it was put on the card. Update the card.`);
}

function checkFamilyLink(entry: SystemEntry, ctx: CheckContext, where: string, add: (level: IssueLevel, section: string, message: string) => void) {
	const link = entry.familyLink!;
	if (!link.perkId) {
		add('error', 'Systems', `${where}: pick which family ability to use, or make the card your own.`);
		return;
	}
	if (!(ctx.families ?? []).includes(link.familyId)) add('error', 'Families', `${where} is a family ability, but this character isn’t in that family. Make the card your own.`);
	if (!ctx.familyPerks) return;
	const perk = ctx.familyPerks.get(link.perkId);
	if (!perk?.details.ability || abilitySystem(perk.details.ability) !== entry.system) {
		add('error', 'Systems', `${where}: this family ability is no longer available. Make the card your own or pick another.`);
		return;
	}
	if (familyCardChanged(entry, perk.details.ability)) add('warning', 'Systems', `${where}: the family has changed this ability since you linked it. Update the card.`);
	const proof = PROOF_LABEL[perk.access];
	if (proof && blank(link.proof)) add('warning', 'Systems', `${where}: add the ${proof.charAt(0).toLowerCase() + proof.slice(1)}.`);
}

/** A family trait comes from one of the character's families' trait perks. */
function checkFamilyTrait(picked: PickedTrait, ctx: CheckContext, add: (level: IssueLevel, section: string, message: string) => void) {
	if (!picked.perkId) {
		// Sheets from before family traits were linked: still allowed, but the reviewer should check it.
		if (ctx.familyPerks) add('warning', 'Traits', `${picked.name} is a Family trait that isn’t linked to a family’s trait: re-add it from “Your families’ traits”.`);
		return;
	}
	if (picked.familyId && !(ctx.families ?? []).includes(picked.familyId)) add('error', 'Families', `${picked.name} is a family trait, but this character isn’t in that family. Remove it.`);
	if (!ctx.familyPerks) return;
	const perk = ctx.familyPerks.get(picked.perkId);
	if (!perk || perk.details.trait !== picked.name) {
		add('error', 'Traits', `${picked.name}: this family trait is no longer offered. Remove it or pick another.`);
		return;
	}
	const proof = PROOF_LABEL[perk.access];
	if (proof && blank(picked.rollProof)) add('warning', 'Traits', `${picked.name}: add the ${proof.charAt(0).toLowerCase() + proof.slice(1)}.`);
}

function checkField(field: Field, value: unknown, where: string, add: (level: IssueLevel, section: string, message: string) => void, traits: string[] = []) {
	if (field.required && blank(value)) {
		add('error', 'Systems', field.rolled ? `${where}: roll your ${field.label}.` : `${where}: fill in ${field.label}.`);
		return;
	}
	const picked = Array.isArray(value) ? value : [value];
	for (const option of field.options ?? []) {
		if (option.permission && picked.includes(option.value)) add('permission', 'Systems', `${where}: ${option.value} (${field.label}) needs permission.`);
		if (option.trait && picked.includes(option.value) && !traits.includes(option.trait)) add('error', 'Systems', `${where}: ${option.value} ${field.label} needs the ${option.trait} trait.`);
	}
	if (field.type === 'list' && Array.isArray(value)) {
		(value as Record<string, string>[]).forEach((row, i) => {
			for (const column of field.columns ?? []) {
				if (column.required && blank(row[column.key])) add('error', 'Systems', `${where}: ${field.label} #${i + 1} is missing “${column.label}”.`);
			}
		});
	}
}

export const hasBlockingIssues = (issues: Issue[]) => issues.some((i) => i.level === 'error');

/** "needs permission" items an admin already approved become 'approved' (the message stays the same, so it still matches). */
export const applyApproved = (issues: Issue[], approved: readonly string[] | undefined) =>
	approved?.length ? issues.map((i) => (i.level === 'permission' && approved.includes(i.message) ? { ...i, level: 'approved' as const } : i)) : issues;

/** A check's identity for Override Mode's Ignore: its section, card and wording, with numbers left out
 * so a changed count (e.g. "45/40 PTP") stays the same check. */
export const issueKey = (i: Pick<Issue, 'section' | 'message' | 'card'>) => `${i.section}|${i.card ?? ''}|${i.message.replace(/\d+(\.\d+)?/g, '#')}`;

/** Checks staff ignored in Override Mode become 'ignored': they don't block, and players don't see them. */
export const applyIgnored = (issues: Issue[], ignored: readonly string[] | undefined) =>
	ignored?.length ? issues.map((i) => (i.level !== 'approved' && ignored.includes(issueKey(i)) ? { ...i, level: 'ignored' as const } : i)) : issues;

/** An approved item's text without the "needs permission" part. */
export const approvedText = (message: string) => message.replace(/ needs? permission\.?/, '');

/** A Heavenly Restriction: granted to the account, only JJK and Cyberpunk, and the stats and fields it sets. */
function checkHeavenly(sheet: Sheet, ctx: CheckContext, add: (level: IssueLevel, section: string, message: string) => void, staff: (path: string) => boolean) {
	const hr = heavenlyOf(sheet);
	if (!hr) return;
	const effect = sheetHeavenly(sheet)!;
	const name = `${hr} Heavenly Restriction`;
	// Asked for in a stat override instead of granted to the account.
	const asked = sheet.systems.find((e) => e.system === 'jujutsu-kaisen' && e.statOverride?.heavenly !== undefined)?.statOverride;
	if (asked && !ctx.isEvolution && ctx.heavenlyGrant !== hr) {
		const why = asked.heavenly?.trim() ?? '';
		if (!why) add('error', 'Systems', `${name}: say why you should start with it (Heavenly Restriction tab).`);
		else add('permission', 'Systems', `${name} (asked for in a stat override): “${why}”`);
	} else if (ctx.heavenlyGrant !== undefined && !ctx.isEvolution) {
		if (ctx.heavenlyGrant === hr) add('permission', 'Systems', `${name} (granted to this account ✓).`);
		else add('error', 'Systems', `${name}: it’s Permission Based and isn’t granted to your account${ctx.heavenlyGrant ? ` (you were granted ${ctx.heavenlyGrant})` : ''}. Set it to None or ask the admins.`);
	} else if (!ctx.isEvolution) add('permission', 'Systems', `${name} needs a grant.`);
	for (const e of sheet.systems) {
		if (!HEAVENLY_SYSTEMS.includes(e.system)) add('error', 'Systems', `${name}: you lose every power system but Jujutsu Kaisen and Cyberpunk. Remove ${systemById.get(e.system)?.label ?? e.system}.`);
	}
	const card = sheet.systems.find((e) => e.system === 'jujutsu-kaisen')!;
	for (const [key, value] of Object.entries(effect.fixed)) {
		if (card.fields[key] !== value && !staff(cardPath(card.key, key))) add('error', 'Systems', `${name}: ${systemById.get('jujutsu-kaisen')?.fields.find((f) => f.key === key)?.label ?? key} is ${value}.`);
	}
	if (ctx.isEvolution) return;
	if (effect.lockStats && effect.baseRank) {
		for (const stat of ['strength', 'speed', 'defense', 'stamina'] as const) {
			if (sheet.stats[stat] !== effect.baseRank && !staff(`stats.${stat}`)) add('error', 'Stats', `${name}: ${stat[0].toUpperCase() + stat.slice(1)} is set to ${effect.baseRank}.`);
		}
	}
	if (effect.lockIntelligence && sheet.stats.intelligence !== effect.baseIntelligence && !staff('stats.intelligence')) add('error', 'Stats', `${name}: Intelligence is set to ${effect.baseIntelligence}.`);
	if (effect.phase !== undefined && !staff('stats.phase') && (effect.lockPhase ? sheet.stats.phase !== effect.phase : sheet.stats.phase < effect.phase)) {
		add('error', 'Stats', `${name}: you start in Phase ${effect.phase}.`);
	}
}

/** A stat override's 🔑 message (each card has at most one). */
export const isStatOverride = (i: Issue) => i.level === 'permission' && Boolean(i.card) && /: stat override \(/.test(i.message);

/**
 * A stat override dropped (cancelled by the player, or denied by staff): the card goes back to the
 * starting stats, loses choices that need permission (God), and points spent past the start come off
 * stat by stat until they fit. Values staff set or a Heavenly Restriction fixes stay.
 */
export function dropStatOverride(sheet: Sheet, entry: SystemEntry, staffOverrides: StaffOverrides = {}) {
	const def = systemById.get(entry.system);
	const was = entry.statOverride;
	delete entry.statOverride;
	if (!def) return;
	// A Heavenly Restriction or Barrier Techniques asked for in the override go too.
	if (was?.heavenly !== undefined) entry.fields.heavenlyRestriction = 'None';
	if (was?.barrier !== undefined && !barrierUnlocked(sheet, entry, { staffOverrides })) entry.fields.barrierTechniques = [];
	const kept = entry.system === 'jujutsu-kaisen' ? (sheetHeavenly(sheet)?.fixed ?? {}) : {};
	const ours = def.fields.filter((x) => !(x.key in kept) && !staffOverrides[cardPath(entry.key, x.key)]);
	for (const x of ours) {
		if (pastStart(x, entry.fields[x.key])) entry.fields[x.key] = x.default ?? (typeof x.startsAt === 'number' ? x.startsAt : (x.startsAt?.[0] ?? ''));
		const v = entry.fields[x.key];
		if (x.type === 'multiselect' && Array.isArray(v)) entry.fields[x.key] = (v as string[]).filter((o) => !x.options?.find((opt) => opt.value === o)?.permission);
	}
	for (const x of ours) {
		const b = systemBudget(sheet, entry);
		if (!b || b.spent <= b.total) break;
		if (x.type !== 'select' || x.default === undefined || entry.fields[x.key] === x.default) continue;
		const was = entry.fields[x.key];
		entry.fields[x.key] = x.default;
		if ((systemBudget(sheet, entry)?.spent ?? 0) >= b.spent) entry.fields[x.key] = was;
	}
}

/** Staff denied a card's stat override (see dropStatOverride). */
export function denyStatOverride(sheet: Sheet, card: string, staffOverrides: StaffOverrides = {}): Sheet {
	const next: Sheet = JSON.parse(JSON.stringify(sheet));
	const entry = next.systems.find((e) => e.key === card);
	if (entry) dropStatOverride(next, entry, staffOverrides);
	return next;
}
