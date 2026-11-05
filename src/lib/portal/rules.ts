// Live rule checks for the submit form. Everything here is a pure function of the sheet,
// so the same checks can run in the form, on the admin dashboard and in tests.
import { currencyChanged, treeProblems } from './customTree.ts';
import { HEAVENLY_RANKS, HEAVENLY_SYSTEMS, heavenlyOf, sheetHeavenly } from './heavenly.ts';
import { DIVINE_PHASE, DIVINE_RANKS } from './divine.ts';
import ranksData from '../../data/portal/ranks.json' with { type: 'json' };
import rulesData from '../../data/portal/rules.json' with { type: 'json' };
import traitsData from '../../data/portal/traits.json' with { type: 'json' };
import type { LinkablePerk } from './families.ts';
import { PROOF_LABEL, familyCardChanged, type PickedTrait, type Sheet, type SystemEntry } from './sheet.ts';
import { abilitySystem, countsTowardLimit, pastStart, startText, systemById, visibleFields, type Field } from './systems.ts';

export const ranks = ranksData.ranks;
export const rules = rulesData;
export const traits = traitsData.traits;

const rankByName = new Map([...ranks, ...HEAVENLY_RANKS, ...DIVINE_RANKS].map((r) => [r.rank, r as (typeof ranks)[number]]));
const traitByName = new Map(traits.map((t) => [t.name, t]));
const slotsByRarity = new Map(rules.traitSlots.rarities.map((r) => [r.id, r.slots]));

/** 'error' blocks sending for review; 'warning' is shown to player and admins; 'permission' flags a pick that needs an admin's OK. */
export type IssueLevel = 'error' | 'warning' | 'permission' | 'approved';
export interface Issue {
	level: IssueLevel;
	section: string;
	message: string;
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
	claims?: Map<string, { name: string; usedSlots: number; maxUsers: number | null; category?: string }>;
	/** Power-set limits from the character's discovered trait combinations. */
	comboSystemLimits?: Record<string, number>[];
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
	/** The family perks the player can link, by id. Without it, linked cards aren't checked against their perk. */
	familyPerks?: Map<string, LinkablePerk>;
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
	const add = (level: IssueLevel, section: string, message: string) => issues.push({ level, section, message });
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
	if (!oc) return issues; // canon tryouts use the lighter sheet

	// ── S.T.S stats ──
	const s = sheet.stats;
	for (const stat of ['strength', 'speed', 'defense', 'stamina'] as const) {
		if (blank(s[stat])) add('error', 'Stats', `Pick a rank for ${stat[0].toUpperCase() + stat.slice(1)}.`);
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
		if (!staff('potential.grade')) add('error', 'Traits', 'Roll your Potential.');
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
	if (sheet.traits.filter((t) => t.family).length > rules.traitSlots.familyTrait.max) add('error', 'Traits', 'Only one trait can be a Family trait.');
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
	for (const id of ctx.requestedClaims ?? []) {
		const claim = ctx.claims?.get(id);
		if (!claim) add('error', 'Systems', 'A picked canon claim no longer exists.');
		else if (!ctx.heldClaimIds?.has(id) && claim.maxUsers !== null && claim.usedSlots >= claim.maxUsers) {
			add('error', 'Systems', `${claim.name} is already full (${claim.usedSlots}/${claim.maxUsers}).`);
		}
		if (claim && rules.permissionClaimCategories.includes(claim.category ?? '')) {
			add(
				'permission',
				inFamily ? 'Families' : 'Systems',
				inFamily
					? `${claim.name} is ${claim.category}: the family that holds it (or an admin) confirms it.`
					: `${claim.name} is ${claim.category}: pick the family that holds it in the Families step.`,
			);
		}
	}

	return issues;
}

function checkSystems(sheet: Sheet, ctx: CheckContext, add: (level: IssueLevel, section: string, message: string) => void) {
	const staff = (path: string) => Boolean(ctx.staffOverrides?.[path]);
	const entries = sheet.systems;
	if (entries.length > 1 && !entries.some((e) => e.key === sheet.prioritySystem)) {
		add('error', 'Systems', 'With more than one power system, pick your priority system.');
	}
	checkHeavenly(sheet, ctx, add, staff);
	const counts = new Map<string, number>();
	for (const e of entries) {
		if (countsTowardLimit(systemById.get(e.system), e.fields)) counts.set(e.system, (counts.get(e.system) ?? 0) + 1);
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
		const def = systemById.get(entry.system);
		if (!def) {
			add('error', 'Systems', `Unknown power system “${entry.system}”.`);
			continue;
		}
		const link = entry.familyLink;
		const where = link ? `${def.label} (${link.title})` : def.label;
		if (entry.customTree) {
			for (const problem of treeProblems(entry.customTree, entry)) add('error', 'Systems', `${where}: ${problem}`);
			const approved = ctx.approvedSheet?.systems.find((e) => e.key === entry.key)?.customTree;
			if (currencyChanged(entry.customTree, approved)) {
				const c = entry.customTree.custom;
				const conversion = c.convertFrom ? `, ${c.convertFromAmount} ${c.convertFrom} → ${c.convertToAmount} ${c.code}` : '';
				add('permission', 'Systems', `${where}: custom currency “${c.name}” (+${c.gain} ${c.code} per session${conversion}) needs its rates approved.`);
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
					add('error', 'Systems', `${where} can’t be combined with ${systemById.get(other.system)?.label ?? other.system}.`);
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
				if (!missingRolls.has(field.rolled)) add('error', 'Systems', `${where}: roll your ${field.label}.`);
				missingRolls.add(field.rolled);
				continue;
			}
			checkField(field, entry.fields[field.key], where, add);
		}
		// A new character starts at set stats; going past them needs a stat override staff approve.
		if (!ctx.isEvolution) {
			const fixed = entry.system === 'jujutsu-kaisen' ? (sheetHeavenly(sheet)?.fixed ?? {}) : {};
			const past = visibleFields(def, entry.fields).filter((f) => !(f.key in fixed) && !staff(cardPath(entry.key, f.key)) && pastStart(f, entry.fields[f.key]));
			if (past.length && entry.statOverride) {
				const list = past.map((f) => `${f.label} ${entry.fields[f.key]}`).join(', ');
				if (blank(entry.statOverride.reason)) add('error', 'Systems', `${where}: explain why you're asking for a stat override.`);
				else add('permission', 'Systems', `${where}: stat override (${list}): “${entry.statOverride.reason.trim()}”`);
			} else {
				for (const f of past) add('error', 'Systems', `${where}: ${f.label} starts at ${startText(f)}. Ask for a stat override to start higher.`);
			}
		}

		const budget = systemBudget(sheet, entry);
		if (!ctx.isEvolution && budget && budget.spent > budget.total) add('warning', 'Systems', `${where}: ${budget.spent} ${budget.label} spent, but you start with ${budget.total}.`);
		for (const extra of def.checks?.(entry.fields, !ctx.isEvolution) ?? []) add(extra.level, 'Systems', extra.message);
		const moves = def.startingMoves?.(entry.fields);
		for (const type of ['standard', 'ultimate'] as const) {
			const max = moves?.[type];
			if (max === undefined) continue;
			const name = type === 'standard' ? moves?.label ?? 'Standard skill' : 'Ultimate skill';
			const count = entry.skills.filter((sk) => sk.type === type).length;
			const min = minimumMoves(max);
			if (count < min) add('error', 'Systems', `${where}: add at least ${min} ${name}${min === 1 ? '' : 's'} (you have ${count}).`);
			else if (!ctx.isEvolution && count > max) add('warning', 'Systems', `${where}: ${count} ${name}s, but you can start with ${max}.`);
		}
		for (const skill of entry.skills) {
			if (blank(skill.name)) add('error', 'Systems', `${where}: a skill is missing its name.`);
			if (skill.type === 'passive') add('permission', 'Systems', `${where}: custom passive “${skill.name || 'unnamed'}” needs permission.`);
		}
	}
}

function checkFamilyLink(entry: SystemEntry, ctx: CheckContext, where: string, add: (level: IssueLevel, section: string, message: string) => void) {
	const link = entry.familyLink!;
	if (!link.perkId) {
		add('error', 'Systems', `${where}: pick which family ability to use, or make the card your own.`);
		return;
	}
	if (!(ctx.families ?? []).includes(link.familyId)) add('error', 'Families', `${where} is a family ability: pick that family in the Families step.`);
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
	if (picked.familyId && !(ctx.families ?? []).includes(picked.familyId)) add('error', 'Families', `${picked.name} is a family trait: pick that family in the Families step.`);
	if (!ctx.familyPerks) return;
	const perk = ctx.familyPerks.get(picked.perkId);
	if (!perk || perk.details.trait !== picked.name) {
		add('error', 'Traits', `${picked.name}: this family trait is no longer offered. Remove it or pick another.`);
		return;
	}
	const proof = PROOF_LABEL[perk.access];
	if (proof && blank(picked.rollProof)) add('warning', 'Traits', `${picked.name}: add the ${proof.charAt(0).toLowerCase() + proof.slice(1)}.`);
}

function checkField(field: Field, value: unknown, where: string, add: (level: IssueLevel, section: string, message: string) => void) {
	if (field.required && blank(value)) {
		add('error', 'Systems', field.rolled ? `${where}: roll your ${field.label}.` : `${where}: fill in ${field.label}.`);
		return;
	}
	const picked = Array.isArray(value) ? value : [value];
	for (const option of field.options ?? []) {
		if (option.permission && picked.includes(option.value)) add('permission', 'Systems', `${where}: ${option.value} (${field.label}) needs permission.`);
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

/** An approved item's text without the "needs permission" part. */
export const approvedText = (message: string) => message.replace(/ needs? permission\.?/, '');

/** A Heavenly Restriction: granted to the account, only JJK and Cyberpunk, and the stats and fields it sets. */
function checkHeavenly(sheet: Sheet, ctx: CheckContext, add: (level: IssueLevel, section: string, message: string) => void, staff: (path: string) => boolean) {
	const hr = heavenlyOf(sheet);
	if (!hr) return;
	const effect = sheetHeavenly(sheet)!;
	const name = `${hr} Heavenly Restriction`;
	if (ctx.heavenlyGrant !== undefined && !ctx.isEvolution) {
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
