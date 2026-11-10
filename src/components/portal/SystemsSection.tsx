// Power system cards: each system's own stat block, canon picks and skills.
import { Fragment } from 'preact';
import { useState } from 'preact/hooks';
import type { ClaimRow, Universe } from '../../lib/portal/api.ts';
import type { LinkablePerk } from '../../lib/portal/families.ts';
import { cardPath, dropStatOverride, traitEffectsFor, minimumMoves, rules, systemBudget, systemLimit, type Issue, type StaffOverrides } from '../../lib/portal/rules.ts';
import { PROOF_LABEL, familyCardChanged, type Sheet, type Skill, type SystemEntry } from '../../lib/portal/sheet.ts';
import { treeCurrencyLabel, type CustomTree } from '../../lib/portal/customTree.ts';
import { lockPastStart, startingMax } from '../../lib/portal/skillLocks.ts';
import { CustomTreeBuilder, type VisualTreeNode } from './CustomTreeBuilder.tsx';
import { isTrackedField, TRACKED_HELP } from '../../lib/portal/points.ts';
import { HEAVENLY_SYSTEMS, applyHeavenly, heavenlyEffect, heavenlyOf, isHeavenly } from '../../lib/portal/heavenly.ts';
import { OverclockRolls, QuirkRolls } from './EvolutionRolls.tsx';
import { CyberwareBay } from './CyberwareBay.tsx';
import { DevilStats, FearUpgrades } from './DevilSheet.tsx';
import { AdollaLinks, FireStats, TechniqueGuide, TephrosisClock } from './FireSheet.tsx';
import { ArrowRolls, StandGauges, UpgradeTracks } from './JojoSheet.tsx';
import { GhoulStats, RcTank } from './GhoulSheet.tsx';
import { ConduitStats, EvolutionItems, KarmaBar, PsychicMind } from './ConduitSheet.tsx';
import { canonConduit, canonConduitFields } from '../../lib/portal/canonConduits.ts';
import { AwakeningLog } from './QuirkSheet.tsx';
import { awakeningLog, newAwakening, withAwakenings } from '../../lib/portal/awakenings.ts';
import { hasKagune, isGhoul, isQuinx } from '../../lib/portal/ghouls.ts';
import { HAMON_TRACKS, SPIN_TRACKS, hasHamon, hasSpin, hasStand } from '../../lib/portal/jojo.ts';
import { deriveDevil } from '../../lib/portal/devils.ts';
import { piecesOf, slotsOf } from '../../lib/portal/cyberware.ts';
import { VARIANT_OF, quirkRollStage, type EvolutionRoll } from '../../lib/portal/evolutionRolls.ts';
import { potentialCtxOf, potentialState, potentialsFor, type PotentialDef, type PotentialState } from '../../lib/portal/potentials.ts';
import { abilitySystem, type MoveLimits, type DefaultMove, countsTowardLimit, familyScope, groupedFields, memberKeys, pastStart, startText, systemById, systems, visibleFields, type Field, type Fields, type FieldValue, type Option, type SystemDef, EXTRAS_GROUP, EXTRAS_KEY, barrierUnlocked, BARRIER_GROUP, BARRIER_KINDS, BARRIER_KEYS, OCULAR_GROUP, OCULAR_KEYS } from '../../lib/portal/systems.ts';
import { CheckboxGroup, NumberField, Section, SelectField, TextArea, TextField } from './fields.tsx';
import { RollPanel, type Roller } from './RollPanel.tsx';
import { PinBoxes } from './PinnedNotes.tsx';
import canonBlurbs from '../../data/portal/canon-blurbs.json' with { type: 'json' };
import { canonQuirk } from '../../lib/portal/canonQuirks.ts';
import { canonIgnition, ignitionInfo, ONE_USER_CATEGORIES } from '../../lib/portal/canonIgnitions.ts';
import { canonStand, canonStandFields, STAND_STAT_LABELS, STAND_STAT_SHORT } from '../../lib/portal/canonStands.ts';
import { BarrierList, type BarrierEntry } from './BarrierSheet.tsx';
import { OcularPanel, ocularSpots } from './OcularSheet.tsx';
import { ADAPTATION_TRAIT } from '../../lib/portal/fireforce.ts';
import { withTechniques, type LinkEntry } from '../../lib/portal/fireforceLogs.ts';

const blurbKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
/** The Index-style blurb for a canon claim, if there is one. */
function canonBlurb(claim: ClaimRow | undefined): string | undefined {
	if (!claim) return undefined;
	const list = (canonBlurbs as unknown as Record<string, Record<string, string> | string>)[claim.universe];
	if (!list || typeof list === 'string') return undefined;
	const hit = Object.entries(list).find(([name]) => blurbKey(name) === blurbKey(claim.name));
	return hit?.[1];
}
/** The look of a picked canon ability: an effect and two colours. Unlisted ones get a soft shimmer. */
type CanonFx = 'burst' | 'split' | 'spark' | 'rise' | 'fall' | 'swirl' | 'streak' | 'pulse' | 'shimmer';
const CANON_THEMES: Record<string, { fx: CanonFx; a: string; b: string }> = {
	explosion: { fx: 'burst', a: '#ff8a1f', b: '#ffd23f' },
	halfhothalfcold: { fx: 'split', a: '#7fd3ff', b: '#ff5a2a' },
	halfcoldhalfhot: { fx: 'split', a: '#7fd3ff', b: '#ff5a2a' },
	electrification: { fx: 'spark', a: '#ffe14d', b: '#fff7b0' },
	oneforall: { fx: 'spark', a: '#3dff8f', b: '#c6ffd9' },
	hellflame: { fx: 'rise', a: '#ff6a1a', b: '#ffcf4a' },
	cremation: { fx: 'rise', a: '#3d8bff', b: '#9fe3ff' },
	stress: { fx: 'rise', a: '#a54bff', b: '#ff4b8b' },
	decay: { fx: 'fall', a: '#b8b0a4', b: '#7d756b' },
	warpgate: { fx: 'swirl', a: '#7b3dff', b: '#22123d' },
	warping: { fx: 'swirl', a: '#b04bff', b: '#2a1240' },
	allforone: { fx: 'swirl', a: '#ff2a4b', b: '#1a0a10' },
	chronostasis: { fx: 'swirl', a: '#e0c060', b: '#3a3018' },
	whirlwind: { fx: 'streak', a: '#7fffe0', b: '#e6fffa' },
	cloud: { fx: 'streak', a: '#e8f0ff', b: '#a9bdd9' },
	erasure: { fx: 'pulse', a: '#ff3045', b: '#ff8a96' },
	bloodcurdle: { fx: 'pulse', a: '#c4122f', b: '#ff5a6e' },
	overhaul: { fx: 'pulse', a: '#e0e0e0', b: '#9a1b2b' },
	neworder: { fx: 'pulse', a: '#ffe28a', b: '#ffffff' },
	copy: { fx: 'pulse', a: '#4be3ff', b: '#c0f6ff' },
};
// Canon Quirks without their own look use Half Hot Half Cold's; canon Ignitions use Hellflame's fire.
/** A canon Ignition's own look, when canon-ignitions.json gives it one. */
const ignitionLook = (name: string) => {
	const l = ignitionInfo(name)?.look;
	return l ? { fx: l[0] as CanonFx, a: l[1], b: l[2] } : undefined;
};
const canonTheme = (name: string, universe?: string) =>
	(universe === 'fire-force' ? ignitionLook(name) : undefined) ??
	CANON_THEMES[blurbKey(name)] ??
	(canonQuirk(name) ? CANON_THEMES.halfhothalfcold : universe === 'fire-force' ? CANON_THEMES.hellflame : { fx: 'shimmer' as const, a: 'var(--sl-color-text-accent)', b: 'var(--sl-color-text-accent)' });

/** A canon claim belongs to the first card of its system's series (a character holds one per series). */
function canonClaimFor(sheet: Sheet, entry: SystemEntry, requested: string[], board: ClaimRow[]): ClaimRow | undefined {
	const universe = systemById.get(entry.system)?.universe;
	if (!universe) return undefined;
	const first = sheet.systems.find((e) => systemById.get(e.system)?.universe === universe);
	if (first?.key !== entry.key) return undefined;
	return requested.map((id) => board.find((r) => r.id === id)).find((r) => r?.universe === universe && r?.claim_type === 'ability');
}
import type { PinnedNote } from '../../lib/portal/pins.ts';

interface Props {
	sheet: Sheet;
	update: (fn: (s: Sheet) => void) => void;
	requestedClaims: string[];
	setRequestedClaims: (ids: string[]) => void;
	claimBoard: ClaimRow[];
	universes: Universe[];
	heldClaims: Set<string>;
	comboSystemLimits: Record<string, number>[];
	/** Names of the Combo traits the database found for the character. */
	combos?: string[];
	readOnly: boolean;
	isEvolution: boolean;
	roller: Roller;
	/** Ability perks of the character's families (null while loading). */
	familyAbilities: LinkablePerk[] | null;
	familyName: (id: string) => string;
	/** Cards on the approved sheet: their upgrade point fields come from the wallets. */
	trackedCards?: Set<string>;
	/** The Heavenly Restriction granted for this character (null: none; undefined: not known yet). */
	heavenlyGrant?: string | null;
	/** Uploads a picture (an Ocular's eye) and returns its link. */
	uploadImage?: (file: File) => Promise<string>;
	/** Values staff set (card:<key>.<field>): locked for the player. */
	staffOverrides?: StaffOverrides;
	/** Notes reviewers pinned to cards (target card:<key>). */
	pins?: PinnedNote[];
	/** The rules check, for each card's status on the home page. */
	issues?: Issue[];
	/** Local testing only (the dev preview's ?all): every locked tab and potential opens. */
	unlockAll?: boolean;
	/** An admin's own character: no limits at all, and any value can be typed in (custom CE levels and so on). */
	adminCharacter?: boolean;
}

const newKey = () => Math.random().toString(36).slice(2, 10);

export function defaults(fields: Field[]) {
	const out: Record<string, FieldValue> = {};
	for (const f of fields) if (f.default !== undefined) out[f.key] = f.default;
	return out;
}

// Labels from the Index: Cursed Energy › Control and Output, and CE Levels › Recharge.
const JJK_LEVEL_OPTIONS: Record<string, { value: string; label: string }[]> = {
	ceControl: [
		{ value: '0', label: 'Level 0 (start): full leakage, readable attacks' },
		{ value: '1', label: 'Level 1: −2 CEP leakage' },
		{ value: '2', label: 'Level 2: −2 CEP leakage, opponents can’t read your attacks' },
		{ value: '3', label: 'Level 3: −2 CEP leakage, unlocks CE Re-Enforcement' },
		{ value: '4', label: 'Level 4: −2 CEP leakage' },
		{ value: '5', label: 'Level 5: no more leakage, can use Barrier Techniques' },
	],
	rp2rpRecharge: [
		{ value: '0', label: 'Level 0 (start): +2 CEP each RP' },
		{ value: '1', label: 'Level 1: +4 CEP each RP' },
		{ value: '2', label: 'Level 2: +6 CEP each RP' },
		{ value: '3', label: 'Level 3: +8 CEP each RP' },
		{ value: '4', label: 'Level 4: +10 CEP each RP' },
	],
	completeRecharge: [
		{ value: '0', label: 'Level 0 (start): tank refills after 5 RPs' },
		{ value: '1', label: 'Level 1: refills after 4 RPs' },
		{ value: '2', label: 'Level 2: refills after 3 RPs' },
		{ value: '3', label: 'Level 3: refills after 2 RPs' },
		{ value: '4', label: 'Level 4: refills after 1 RP' },
	],
};

/** A select that also takes any typed value: admin characters can set things outside the lists. */
function FreeSelect(props: { label: string; help?: string; value: string; options: { value: string; label?: string; group?: string }[]; disabled: boolean; onChange: (v: string) => void }) {
	const listed = props.value === '' || props.options.some((o) => o.value === props.value && !/\(custom\)$/.test(o.label ?? ''));
	const [typing, setTyping] = useState(!listed);
	if (typing)
		return (
			<div class="free-select">
				<TextField label={`${props.label} (custom)`} help={props.help} value={props.value} disabled={props.disabled} placeholder="Type any value" onInput={props.onChange} />
				{!props.disabled && (
					<button type="button" class="pf-link-button" onClick={() => setTyping(false)}>
						Pick from the list
					</button>
				)}
			</div>
		);
	return (
		<div class="free-select">
			<SelectField label={props.label} help={props.help} value={props.value} options={props.options.map((o) => ({ ...o, disabled: false }))} disabled={props.disabled} onChange={props.onChange} />
			{!props.disabled && (
				<button type="button" class="pf-link-button" onClick={() => setTyping(true)}>
					✎ Type a custom value
				</button>
			)}
		</div>
	);
}

export function FieldInput(props: {
	field: Field;
	value: FieldValue | undefined;
	onChange: (v: FieldValue) => void;
	/** For lists: change the latest value, so quick edits to several cells don't overwrite each other. */
	onUpdate?: (fn: (prev: FieldValue | undefined) => FieldValue) => void;
	disabled: boolean;
	blocked?: { value: string; reason: string };
	/** Hold the field at its starting value (a new character without a stat override). */
	atStart?: boolean;
	/** Without a stat override: would this choice spend past the starting points? */
	overBudget?: (v: string) => boolean;
	/** Without a stat override, choices that need staff permission (God) are locked. */
	lockPermission?: boolean;
	/** The character's traits: options only a trait opens (Bio-King's Colossal power) need it. */
	traits?: string[];
	/** An admin character: every option open, no minimums, and any value can be typed in. */
	free?: boolean;
}) {
	const { field, value, onChange } = props;
	const blocked = props.free ? undefined : props.blocked;
	const atStart = !props.free && props.atStart && field.startsAt !== undefined;
	const label = field.label;
	const help = atStart ? [field.help, `Starts at ${startText(field)}; higher needs a stat override.`].filter(Boolean).join(' ') : field.help;
	const startChoices = atStart && Array.isArray(field.startsAt) ? field.startsAt : null;
	const options = (field.options ?? []).map((o: Option) => {
		const isBlocked = blocked?.value === o.value && value !== o.value;
		const selected = Array.isArray(value) ? (value as string[]).includes(o.value) : value === o.value;
		const pastStart = !props.free && (Boolean(startChoices && !startChoices.includes(o.value) && !selected) || Boolean(props.lockPermission && o.permission && !selected));
		const noTrait = !props.free && Boolean(o.trait && props.traits && !props.traits.includes(o.trait) && !selected);
		const noPoints = !props.free && !pastStart && !noTrait && !selected && Boolean(props.overBudget?.(o.value));
		const note = isBlocked ? ` (${blocked!.reason})` : noTrait ? ` (needs ${o.trait})` : pastStart ? ' (override)' : noPoints ? ' (no points left)' : '';
		let displayLabel = o.label ?? o.value;
		if (field.key === 'generation' && field.label.toLowerCase().includes('generation')) {
			if (o.value === 'Second') displayLabel = 'Second Generation (Bender)';
			else if (o.value === 'Third') displayLabel = 'Third Generation (Spitfire)';
		}
		return { value: o.value, label: `${displayLabel}${o.permission ? ' 🔑' : ''}${note}`, disabled: isBlocked || pastStart || noPoints || noTrait };
	});
	// A number at its start can't go up (it can still come down if it was set higher before).
	const isJjkLevel = Boolean(JJK_LEVEL_OPTIONS[field.key]);
	const disabled = props.disabled || Boolean(!isJjkLevel && atStart && typeof field.startsAt === 'number' && (Number(value) || 0) <= field.startsAt);

	if (isJjkLevel) {
		const curValStr = String(value !== undefined && value !== '' ? value : '0');
		// Held at the start: the levels above it are locked until a stat override.
		const cap = atStart && typeof field.startsAt === 'number' ? field.startsAt : null;
		const jjkOpts = JJK_LEVEL_OPTIONS[field.key]!.map((o) =>
			cap !== null && Number(o.value) > cap && o.value !== curValStr ? { ...o, label: `${o.label} (override)`, disabled: true } : { ...o },
		);
		if (curValStr !== '' && !jjkOpts.some((o) => o.value === curValStr)) {
			jjkOpts.push({ value: curValStr, label: `Level ${curValStr} (custom)` });
		}
		if (props.free) return <FreeSelect label={label} help={help} value={curValStr} options={jjkOpts} disabled={disabled} onChange={(v) => onChange(/^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v)} />;
		return (
			<SelectField
				label={label}
				help={help}
				required={field.required}
				value={curValStr}
				options={jjkOpts}
				disabled={disabled}
				onChange={(v) => onChange(Number(v))}
			/>
		);
	}

	// A family ability can set its own value outside the list.
	if (field.type === 'select' && value !== undefined && value !== '' && !options.some((o) => o.value === String(value)))
		options.push({ value: String(value), label: `${value} (custom)`, disabled: false });
	if (props.free && field.type === 'select') return <FreeSelect label={label} help={help} value={String(value ?? '')} options={options} disabled={disabled} onChange={onChange} />;
	switch (field.type) {
		case 'select':
			return <SelectField label={label} help={help} required={field.required} value={String(value ?? '')} options={options} disabled={disabled} onChange={onChange} />;
		case 'multiselect':
			return <CheckboxGroup label={label} help={help} required={field.required} values={Array.isArray(value) ? (value as string[]) : []} options={options} disabled={disabled} onChange={onChange} />;
		case 'number':
			return <NumberField label={label} help={help} required={field.required} min={props.free ? undefined : field.min} value={typeof value === 'number' ? value : Number(value) || 0} disabled={disabled} onInput={onChange} />;
		case 'textarea':
			return <TextArea label={label} help={help} required={field.required} rows={3} value={String(value ?? '')} disabled={disabled} onInput={onChange} />;
		case 'list': {
			const rows = (Array.isArray(value) ? value : []) as Record<string, string>[];
			type Rows = Record<string, string>[];
			// Each edit is applied to the newest rows, not the ones this render saw.
			const set = (fn: (prev: Rows) => Rows) =>
				props.onUpdate ? props.onUpdate((prev) => fn((Array.isArray(prev) ? prev : []) as Rows)) : onChange(fn(rows));
			return (
				<div class="pf-wide pf-list">
					<h4 class="pf-subhead">{label}</h4>
					{rows.map((row, i) => (
						<div class="pf-list-row" key={i}>
							{(field.columns ?? []).map((col) =>
								col.type === 'select' ? (
									<SelectField
										key={col.key}
										label={col.label}
										required={col.required}
										value={row[col.key] ?? ''}
										options={(col.options ?? []).map((o) => ({ value: o.value, label: o.label, group: o.group }))}
										disabled={disabled}
										onChange={(v) => set((prev) => prev.map((r, j) => (j === i ? { ...r, [col.key]: v, ...(col.derive?.(v) ?? {}) } : r)))}
									/>
								) : (
									<TextField
										key={col.key}
										label={col.label}
										required={col.required}
										value={row[col.key] ?? ''}
										disabled={disabled}
										onInput={(v) => set((prev) => prev.map((r, j) => (j === i ? { ...r, [col.key]: v } : r)))}
									/>
								),
							)}
							{!disabled && (
								<button type="button" class="pf-button subtle" onClick={() => set((prev) => prev.filter((_, j) => j !== i))}>
									Remove
								</button>
							)}
						</div>
					))}
					{!disabled && (
						<button type="button" class="pf-button" onClick={() => set((prev) => [...prev, Object.fromEntries((field.columns ?? []).filter((c) => c.default !== undefined).map((c) => [c.key, String(c.default)]))])}>
							+ Add {label.replace(/s$/, '').toLowerCase()}
						</button>
					)}
				</div>
			);
		}
		default:
			return <TextField label={label} help={help} required={field.required} value={String(value ?? '')} disabled={disabled} onInput={onChange} />;
	}
}


/** e.g. "needs 1–2 Extension Techniques" or "needs at least 2 Standard skills" */
function describeMoves(limits: MoveLimits, showMax: boolean) {
	const part = (max: number | undefined, name: string) => {
		if (max === undefined || max === 0) return null;
		const min = minimumMoves(max);
		const plural = (n: number) => `${name}${n === 1 ? '' : 's'}`;
		if (!showMax) return min > 0 ? `at least ${min} ${plural(min)}` : null;
		return min === max ? `${max} ${plural(max)}` : `${min}–${max} ${plural(max)}`;
	};
	return [part(limits.standard, limits.label ?? 'Standard skill'), part(limits.ultimate, limits.ultimateLabel ?? 'Ultimate skill')].filter(Boolean).join(' and ');
}

/** Helper to match a skill to a custom tree node */
function findMatchingNode(skill: Skill, nodes: VisualTreeNode[]): VisualTreeNode | undefined {
	if ((skill as any).treeNodeId) {
		const match = nodes.find((n) => n.id === (skill as any).treeNodeId);
		if (match) return match;
	}
	if (skill.name?.trim()) {
		const match = nodes.find((n) => !n.start && n.label?.trim().toLowerCase() === skill.name.trim().toLowerCase());
		if (match) return match;
	}
	return undefined;
}

/** Helper to match a tree node to a skill */
function findMatchingSkill(node: VisualTreeNode, skills: Skill[]): Skill | undefined {
	const matchById = skills.find((s) => (s as any).treeNodeId === node.id);
	if (matchById) return matchById;
	if (node.label?.trim()) {
		const matchByName = skills.find((s) => s.name?.trim().toLowerCase() === node.label.trim().toLowerCase());
		if (matchByName) return matchByName;
	}
	return undefined;
}

/** Sync changes made in SkillsEditor to entry.customTree */
export function syncSkillsToTree(tree: CustomTree, prevSkills: Skill[], nextSkills: Skill[]) {
	if (!tree || !Array.isArray(tree.nodes)) return;
	const rootNode = tree.nodes.find((n) => n.start) || tree.nodes[0];
	const rootId = rootNode?.id || 'start';

	// 1. Detect removed skills and remove corresponding nodes
	const nextNodeIds = new Set(nextSkills.map((s) => (s as any).treeNodeId).filter(Boolean));
	for (const prev of prevSkills) {
		const prevId = (prev as any).treeNodeId;
		if (prevId && !nextNodeIds.has(prevId)) {
			tree.nodes = tree.nodes.filter((n) => n.id !== prevId);
			for (const n of tree.nodes) {
				n.requires = n.requires.filter((r) => r !== prevId);
			}
		} else if (!prevId && prev.name?.trim()) {
			const stillExists = nextSkills.some((s) => s.name?.trim().toLowerCase() === prev.name.trim().toLowerCase());
			if (!stillExists) {
				const matchNode = tree.nodes.find((n) => !n.start && n.label?.trim().toLowerCase() === prev.name.trim().toLowerCase());
				if (matchNode) {
					const delId = matchNode.id;
					tree.nodes = tree.nodes.filter((n) => n.id !== delId);
					for (const n of tree.nodes) n.requires = n.requires.filter((r) => r !== delId);
				}
			}
		}
	}

	// 2. Add or update nodes for each current skill
	nextSkills.forEach((skill, i) => {
		let matchNode = findMatchingNode(skill, tree.nodes as VisualTreeNode[]);
		if (matchNode) {
			matchNode.label = skill.name || `Skill #${i + 1}`;
			matchNode.description = skill.effect || '';
			(skill as any).treeNodeId = matchNode.id;
		} else {
			const newId = (skill as any).treeNodeId || Math.random().toString(36).slice(2, 9);
			(skill as any).treeNodeId = newId;

			const nonRootCount = tree.nodes.filter((n) => !n.start).length;
			const col = nonRootCount % 3;
			const row = Math.floor(nonRootCount / 3);

			const newNode: VisualTreeNode = {
				id: newId,
				label: skill.name || `Skill #${i + 1}`,
				description: skill.effect || '',
				cost: 5,
				requires: rootNode ? [rootId] : [],
				start: false,
				shape: skill.type === 'ultimate' ? 'diamond' : 'rect',
				x: (rootNode ? ((rootNode as any).x ?? 350) : 350) + (col - 1) * 260,
				y: (rootNode ? ((rootNode as any).y ?? 80) : 80) + 160 + row * 150,
			};
			tree.nodes.push(newNode);
		}
	});
}

/** Sync changes made in CustomTreeBuilder to entry.skills */
export function syncTreeToSkills(nextTree: CustomTree, prevTree: CustomTree | null | undefined, entry: SystemEntry, isEvolution = false) {
	if (!nextTree || !Array.isArray(nextTree.nodes)) return;
	const currentSkills = entry.skills ? [...entry.skills] : [];
	const nonRootNodes = nextTree.nodes.filter((n) => !n.start) as VisualTreeNode[];
	const activeNodeIds = new Set(nonRootNodes.map((n) => n.id));

	// 1. Remove skills whose nodes were deleted from the tree
	let updatedSkills = currentSkills.filter((s) => {
		const sId = (s as any).treeNodeId;
		if (sId) {
			return activeNodeIds.has(sId);
		}
		return true;
	});

	if (prevTree && Array.isArray(prevTree.nodes)) {
		const prevNonRoots = prevTree.nodes.filter((n) => !n.start);
		for (const prevNode of prevNonRoots) {
			if (!activeNodeIds.has(prevNode.id)) {
				updatedSkills = updatedSkills.filter((s) => {
					if ((s as any).treeNodeId === prevNode.id) return false;
					if (prevNode.label && s.name?.trim().toLowerCase() === prevNode.label.trim().toLowerCase()) return false;
					return true;
				});
			}
		}
	}

	// 2. Add or update skills for each non-root node
	for (const node of nonRootNodes) {
		const matchSkill = findMatchingSkill(node, updatedSkills);
		if (matchSkill) {
			matchSkill.name = node.label || 'Unnamed Skill';
			matchSkill.effect = node.description || '';
			(matchSkill as any).treeNodeId = node.id;
		} else {
			const newSkill: Skill = {
				name: node.label || 'New Skill',
				type: (node as any).shape === 'diamond' ? 'ultimate' : 'standard',
				effect: node.description || '',
				mastery: 'Untrained (0/5)',
				// After approval a new tree skill is learned by unlocking it with points.
				...(isEvolution ? { locked: true } : {}),
			};
			(newSkill as any).treeNodeId = node.id;
			updatedSkills.push(newSkill);
		}
	}

	entry.skills = updatedSkills;
}

export function SkillsEditor({
	skills,
	onUpdate,
	disabled,
	limits,
	isEvolution,
	isTreeActive,
	tree,
	defaults = [],
	defaultsFrom,
	noLimits = false,
}: {
	skills: Skill[];
	/** Moves the system always gives, shown first and not editable. */
	defaults?: DefaultMove[];
	/** Who has them, e.g. "Every Elemental Conduit". */
	defaultsFrom?: string;
	onUpdate: (fn: (prev: Skill[]) => Skill[]) => void;
	disabled: boolean;
	limits?: MoveLimits;
	isEvolution: boolean;
	isTreeActive?: boolean;
	tree?: CustomTree | null;
	/** An admin character: as many skills of each kind as they like. */
	noLimits?: boolean;
}) {
	const set = (i: number, patch: Partial<Skill>) => onUpdate((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
	const [editing, setEditing] = useState<number | null>(null);
	const needs = limits ? describeMoves(limits, !isEvolution) : '';
	const standardName = limits?.label ?? 'Standard';
	const typeName = { passive: 'Passive', standard: limits?.label ?? 'Standard', ultimate: limits?.ultimateLabel ?? 'Ultimate' };
	const ultimateName = limits?.ultimateLabel ?? 'Ultimate';
	// A new character can only add the skills their system starts with; Maximum-style caps always apply.
	const count = (type: Skill['type']) => skills.filter((s) => s.type === type && !s.locked).length;
	const standardFull = !noLimits && !isEvolution && count('standard') >= startingMax('standard', limits);
	const ultimateFull = !noLimits && count('ultimate') >= (isEvolution ? (limits?.ultimateCap ?? Infinity) : startingMax('ultimate', limits));
	const lockedCount = skills.filter((s) => s.locked).length;
	const nodeCost = (s: Skill) => {
		const node = tree?.nodes.find((n) => n.id === s.treeNodeId);
		return node?.cost ? `${node.cost} ${treeCurrencyLabel(tree!)}` : '';
	};
	const nextType: Skill['type'] | null = !standardFull ? 'standard' : !ultimateFull ? 'ultimate' : null;

	return (
		<div class="pf-wide df-post-section">
			<div class="df-section-head">
				<div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
					<h4 class="df-section-title">
						⚔️ {limits?.label ? `${limits.label}s & Skills` : 'Techniques & Skills'}
						<span class="df-tab-badge">{skills.length}</span>
					</h4>
					{isTreeActive && (
						<span class="df-tree-synced-pill" title="Techniques and custom skill tree nodes stay automatically in sync">
							🌳 Synced with Skill Tree
						</span>
					)}
				</div>
				{needs && <span class="pf-help">{needs}</span>}
				{lockedCount > 0 && <span class="pf-help">{lockedCount} locked from the Skill Tree, not counted here.</span>}
			</div>

			{defaults.length > 0 && (
				<div class="df-default-moves">
					<p class="pf-help">{defaultsFrom ?? 'Every card of this system'} has these. They don’t count toward your own skills.</p>
					<div class="df-techniques-list">
						{defaults.map((m) => (
							<div class={`df-technique-card ${m.type} df-technique-default`} key={m.name}>
								<div class="df-technique-card-header">
									<div class="df-technique-identity">
										<span class="df-technique-icon">{m.type === 'ultimate' ? '💥' : m.type === 'passive' ? '🛡️' : '⚔️'}</span>
										<span class="df-technique-name">{m.name}</span>
										<span class={`df-tag ${m.type === 'passive' ? 'passive' : m.type === 'ultimate' ? 'priority' : 'standard'}`}>{typeName[m.type] ?? m.type}</span>
										{m.cost && <span class="df-tag df-tag-mastery">{m.cost}</span>}
										<span class="df-tag df-tag-locked">Default</span>
									</div>
								</div>
								<p class="df-technique-effect">{m.effect}</p>
							</div>
						))}
					</div>
				</div>
			)}

			{skills.length === 0 && editing === null && (
				<div class="df-skills-empty">
					<span style={{ fontSize: '1.4rem', lineHeight: 1 }}>⚔️</span>
					<div>
						<strong style={{ fontSize: '0.92rem', color: 'var(--pf-text)' }}>{defaults.length ? 'No skills of your own yet' : 'No techniques or skills added yet'}</strong>
						<p class="pf-help" style={{ margin: 0, fontSize: '0.82rem' }}>
							Add standard or ultimate techniques your character has mastered.
						</p>
					</div>
				</div>
			)}

			<div class="df-techniques-list">
				{skills.map((skill, i) =>
					skill.locked ? (
						<div class={`df-technique-card ${skill.type} df-technique-locked`} key={i}>
							<div class="df-technique-card-header">
								<div class="df-technique-identity">
									<span class="df-technique-name">{skill.name || <em>Unnamed technique</em>}</span>
									<span class={`df-tag ${skill.type === 'ultimate' ? 'priority' : 'standard'}`}>{typeName[skill.type] ?? skill.type}</span>
									<span class="df-tag df-tag-locked">Locked</span>
								</div>
							</div>
							<p class="pf-help">
								{isEvolution ? 'Unlock it on the Evolve page' : 'Unlocks after approval'}
								{nodeCost(skill) ? ` for ${nodeCost(skill)}` : ''}. Edit it in the Skill Tree.
							</p>
							{skill.effect ? <p class="df-technique-effect">{skill.effect}</p> : <p class="df-technique-effect df-effect-empty">No description yet. Add one in the Skill Tree.</p>}
						</div>
					) : editing !== i ? (
						<div class={`df-technique-card ${skill.type}`} key={i}>
							<div class="df-technique-card-header">
								<div class="df-technique-identity">
									<span class="df-technique-icon">
										{skill.type === 'ultimate' ? '💥' : skill.type === 'passive' ? '🛡️' : '⚔️'}
									</span>
									<span class="df-technique-name">{skill.name || <em>Unnamed technique</em>}</span>
									<span class={`df-tag ${skill.type === 'passive' ? 'passive' : skill.type === 'ultimate' ? 'priority' : 'standard'}`}>
										{typeName[skill.type] ?? skill.type}
									</span>
									{skill.mastery && <span class="df-tag df-tag-mastery">{skill.mastery}</span>}
								</div>
								{!disabled && (
									<div class="df-technique-card-actions">
										<button
											type="button"
											class="df-btn-edit"
											title="Edit technique"
											onClick={() => setEditing(i)}
										>
											<span class="df-btn-icon">✏️</span>
											<span>Edit</span>
										</button>
										<button
											type="button"
											class="df-btn-remove"
											title="Remove skill"
											onClick={() => onUpdate((prev) => prev.filter((_, j) => j !== i))}
										>
											✕
										</button>
									</div>
								)}
							</div>
							{skill.effect ? (
								<p class="df-technique-effect">{skill.effect}</p>
							) : (
								<p class="df-technique-effect df-effect-empty">No description provided yet.</p>
							)}
						</div>
					) : (
						<div class="df-technique-card-edit" key={i}>
							<div class="df-technique-edit-header">
								<div class="df-technique-edit-title">
									<span style={{ fontSize: '1rem', lineHeight: 1 }}>✏️</span>
									<strong>{skill.name ? `Edit: ${skill.name}` : 'New Technique Details'}</strong>
								</div>
								<span class="df-technique-cost-badge">
									{skill.type === 'passive'
										? 'Passive · Free'
										: skill.type === 'ultimate'
											? `${ultimateName} · 30% Stamina (3-turn cooldown)`
											: 'Standard · 10% Stamina'}
								</span>
							</div>

							<div class="df-technique-edit-grid">
								<TextField
									label="Skill name"
									required
									value={skill.name}
									disabled={disabled}
									placeholder="e.g. Cleave, Fireball, Mirage Step"
									onInput={(v) => set(i, { name: v })}
								/>
								<SelectField
									label="Type"
									value={skill.type}
									disabled={disabled}
									onChange={(v) => set(i, { type: (v || 'standard') as Skill['type'] })}
									options={[
										{ value: 'passive', label: 'Passive (free, needs permission) 🔑' },
										{
											value: 'standard',
											label: limits?.label ? `${standardName} (Standard, 10% Stamina)` : 'Standard (10% Stamina)',
											disabled: standardFull && skill.type !== 'standard',
										},
										{
											value: 'ultimate',
											label: limits?.ultimateLabel ? `${ultimateName} (Ultimate, 30% Stamina, 3-turn cooldown)` : 'Ultimate (30% Stamina, 3-turn cooldown)',
											disabled: ultimateFull && skill.type !== 'ultimate',
										},
									]}
								/>
								<TextField
									label="Mastery"
									value={skill.mastery}
									disabled={disabled}
									placeholder="e.g. Untrained (0/5), Mastered (5/5)"
									onInput={(v) => set(i, { mastery: v })}
								/>
							</div>

							<div class="df-technique-textarea-wrap">
								<TextArea
									label="What it does"
									rows={3}
									value={skill.effect}
									disabled={disabled}
									placeholder="Describe how it triggers, its damage, reach, casting time, or tactical utility..."
									onInput={(v) => set(i, { effect: v })}
								/>
							</div>

							<div class="df-technique-edit-footer">
								{!disabled ? (
									<button
										type="button"
										class="df-btn-delete-tech"
										onClick={() => {
											setEditing(null);
											onUpdate((prev) => prev.filter((_, j) => j !== i));
										}}
									>
										🗑️ Remove Technique
									</button>
								) : <div />}
								<button
									type="button"
									class="df-btn-done"
									onClick={() => setEditing(null)}
								>
									✓ Done
								</button>
							</div>
						</div>
					),
				)}
			</div>

			{!disabled && !nextType && (
				<p class="pf-help">You’ve added every skill you start with. More are learned in RP{isTreeActive ? ' and planned in the Skill Tree' : ''}.</p>
			)}
			{!disabled && nextType && (
				<button
					type="button"
					class="df-btn-add-tech"
					onClick={() => {
						const nextIdx = skills.length;
						onUpdate((prev) => [...prev, { name: '', type: nextType, effect: '', mastery: 'Untrained (0/5)' }]);
						setEditing(nextIdx);
					}}
				>
					<span class="df-add-icon">＋</span>
					<span>Add Technique / Skill</span>
				</button>
			)}
		</div>
	);
}

function ClaimPicker(props: { universe: string; label: string; board: ClaimRow[]; picked: string[]; held: Set<string>; onChange: (ids: string[]) => void; disabled: boolean; free?: boolean }) {
	// One-user categories (Pillars) come first, in their own section, and hold one character each.
	const oneUser = (r: ClaimRow) => props.universe === 'fire-force' && ONE_USER_CATEGORIES.includes(r.category);
	const rows = props.board
		.filter((r) => r.universe === props.universe && r.claim_type === 'ability')
		.map((r) => (oneUser(r) ? { ...r, max_users: 1 } : r))
		.sort((a, b) => Number(oneUser(b)) - Number(oneUser(a)));
	const groupOf = (r: ClaimRow) => (oneUser(r) ? `${r.category}s · one user each` : props.universe === 'fire-force' ? 'Canon Ignitions' : r.category || 'Other');
	const holder = (r: ClaimRow) => r.note || (props.universe === 'fire-force' ? ignitionInfo(r.name)?.holder : props.universe === 'jojo' ? canonStand(r.name)?.user : props.universe === 'infamous' ? canonConduit(r.name)?.user : '') || '';
	const mine = rows.filter((r) => props.picked.includes(r.id));
	// One canon ability per series: picking another swaps it.
	const others = props.picked.filter((id) => !rows.some((r) => r.id === id));
	const full = (r: ClaimRow) => !props.free && r.max_users !== null && r.used_slots >= r.max_users && !props.held.has(r.id);
	const usage = (r: ClaimRow) => (r.max_users === null ? 'no limit' : `${r.used_slots}/${r.max_users}`);
	return (
		<div class="pf-wide claim-picker">
			<h4 class="pf-subhead">{props.label} (optional)</h4>
			{mine.map((r) => {
				const blurb = canonBlurb(r);
				const theme = props.universe === 'fire-force' ? ignitionInfo(r.name)?.theme : undefined;
				return (
					<div class={`canon-card fx-${canonTheme(r.name, r.universe).fx}`} style={{ '--cq-a': canonTheme(r.name, r.universe).a, '--cq-b': canonTheme(r.name, r.universe).b }} key={r.id}>
						<div class="canon-fx" aria-hidden="true" />
						<div class="canon-body">
							<span class="canon-kicker">
								{props.label} · {r.category} · {usage(r)}
								{rules.permissionClaimCategories.includes(r.category) && ' · needs permission'}
							</span>
							<strong class="canon-name">{r.name}</strong>
							{blurb && <p class="canon-blurb">{blurb}</p>}
							{theme && (
								<p class="canon-blurb">
									<b>Theme:</b> {theme}
								</p>
							)}
							{props.universe === 'jojo' && canonStand(r.name) && <StandCanon name={r.name} />}
							{props.universe === 'infamous' && canonConduit(r.name) && (
								<>
									<p class="canon-blurb">{canonConduit(r.name)!.blurb}</p>
									<p class="canon-blurb">
										<b>Class:</b> {canonConduit(r.name)!.class}
										{canonConduit(r.name)!.element && <> · <b>Element:</b> {canonConduit(r.name)!.element}</>}
									</p>
								</>
							)}
							{holder(r) && <p class="canon-holder">In canon: {holder(r)}</p>}
							{!props.disabled && (
								<button type="button" class="pf-button subtle canon-remove" onClick={() => props.onChange(others)}>
									Remove
								</button>
							)}
						</div>
					</div>
				);
			})}
			{!props.disabled && (
				<SelectField
					label={mine.length ? `Swap for another ${props.label.toLowerCase()}` : `Claim a ${props.label.toLowerCase()}`}
					value=""
					placeholder="Pick from the canon list…"
					options={rows
						.filter((r) => !props.picked.includes(r.id))
						.map((r) => ({
							value: r.id,
							label: `${r.name} (${usage(r)}${full(r) ? ', full' : ''})${holder(r) ? ` · ${holder(r)}` : ''}${rules.permissionClaimCategories.includes(r.category) ? ' 🔑' : ''}`,
							group: groupOf(r),
							disabled: full(r),
						}))}
					showGroups={props.universe === 'fire-force' || props.universe === 'jojo' || props.universe === 'infamous'}
					onChange={(id) => id && props.onChange([...others, id])}
					help="One at a time. Full claims can’t be picked. Admins confirm claims when they approve your character."
				/>
			)}
		</div>
	);
}

/** A canon Stand on its claim card: what it is, its canon stats and its Esoteric Ability. */
function StandCanon(props: { name: string }) {
	const s = canonStand(props.name)!;
	return (
		<div class="stand-canon">
			<p class="canon-blurb">{s.about}</p>
			<dl class="stand-stats">
				{STAND_STAT_LABELS.map((label, i) => (
					<div key={label}>
						<dt>
							<span class="long">{label}</span>
							<abbr class="short" title={label}>
								{STAND_STAT_SHORT[i]}
							</abbr>
						</dt>
						<dd>{s.stats[i] === '∅' ? '—' : s.stats[i]}</dd>
					</div>
				))}
			</dl>
			<p class="canon-blurb">
				<b>Esoteric Ability:</b> {s.ability}
			</p>
			<p class="stand-esoteric-note">Awakens with Stand Awakening, or from the start with the Stand Prodigy trait.</p>
		</div>
	);
}

const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** A closed card's summary: its first few short answers and its skill count. */
function cardChips(def: NonNullable<ReturnType<typeof systemById.get>>, entry: SystemEntry) {
	const answers = visibleFields(def, entry.fields)
		.filter((f) => ['select', 'text', 'number'].includes(f.type ?? 'text'))
		.map((f) => entry.fields[f.key])
		.filter((v) => (typeof v === 'number' ? v > 0 : typeof v === 'string' && v.trim() !== '' && v.length <= 28))
		.map(String)
		.slice(0, 3);
	const skills = entry.skills.length;
	return [...answers, ...(skills ? [`${skills} skill${skills === 1 ? '' : 's'}`] : []), ...(entry.customTree ? ['Skill tree'] : [])];
}

/** The top of a power-system card: make your own, or link one of your families' abilities for this system. */
function AbilitySource(props: {
	entry: SystemEntry;
	abilities: LinkablePerk[] | null;
	familyName: (id: string) => string;
	disabled: boolean;
	onOwn: () => void;
	onLink: (perk: LinkablePerk) => void;
	onProof: (v: string) => void;
}) {
	const { entry, abilities } = props;
	const link = entry.familyLink;
	const perk = link && abilities?.find((p) => p.id === link.perkId);
	if (!link && !abilities?.length) return null;
	const proof = perk && PROOF_LABEL[perk.access];
	const outdated = perk?.details.ability && familyCardChanged(entry, perk.details.ability);
	return (
		<div class="pf-wide ab-source">
			<div class="ab-choice" role="radiogroup" aria-label="Where this ability comes from">
				<button type="button" role="radio" aria-checked={!link} class={!link ? 'active' : undefined} disabled={props.disabled} onClick={() => link && props.onOwn()}>
					Make my own
				</button>
				<button
					type="button"
					role="radio"
					aria-checked={Boolean(link)}
					class={link ? 'active' : undefined}
					disabled={props.disabled || !abilities?.length}
					onClick={() => {
						// With one family ability, link it straight away; otherwise the player picks below.
						if (!link && abilities?.length) props.onLink(abilities.length === 1 ? abilities[0] : { ...abilities[0], id: '', title: '' });
					}}
				>
					Use a family ability
				</button>
			</div>
			{link && (
				<>
					<SelectField
						label="Family ability"
						required
						value={link.perkId}
						placeholder={abilities ? 'Pick one of your families’ abilities…' : 'Loading…'}
						disabled={props.disabled}
						options={(abilities ?? []).map((p) => ({ value: p.id, label: p.title, group: props.familyName(p.family_id) }))}
						onChange={(id) => {
							const next = abilities?.find((p) => p.id === id);
							if (next) props.onLink(next);
						}}
						help="Abilities from this character’s family."
					/>
					{link.perkId && abilities && !perk && (
						<p class="pf-wide roll-note bad">“{link.title}” isn’t available any more: the family removed it, or this character no longer picks that family.</p>
					)}
					{perk && (
						<p class="pf-wide pf-help">
							From <strong>{props.familyName(perk.family_id)}</strong>. Its stats and skills are set by the family; describe how your character uses it below.
						</p>
					)}
					{outdated && !props.disabled && (
						<p class="pf-wide roll-note">
							The family has changed this ability since you linked it.{' '}
							<button type="button" class="pf-button" onClick={() => props.onLink(perk!)}>
								Update the card
							</button>
						</p>
					)}
					{proof && <TextField label={proof} required value={link.proof} placeholder="https://discord.com/channels/…" disabled={props.disabled} onInput={props.onProof} />}
				</>
			)}
		</div>
	);
}

/**
 * A new character asking staff to start past the usual stats. Starting stats and points are held
 * until the player presses Request override on the card's top bar: that unlocks every option on the
 * card, and this box asks why. Approved, the picks stay; denied, the card goes back to the start.
 */
function StatOverride(props: { request: { reason: string; ask?: string }; freeText: boolean; disabled: boolean; onChange: (v: { reason: string; ask?: string }) => void }) {
	const { request, freeText, disabled, onChange } = props;
	return (
		<div class="so-panel">
			<div class="so-head">
				<span class="so-kicker">Stat override · staff review</span>
				<strong>{freeText ? 'Say what you want to start with, and why' : 'Every option on this card is unlocked. Pick what you want, then tell staff why.'}</strong>
			</div>
			{freeText && (
				<TextArea label="What you want to start with" required rows={2} value={request.ask ?? ''} disabled={disabled} placeholder="e.g. A Grade 2 Rc Tank" onInput={(ask) => onChange({ ...request, ask })} />
			)}
			<TextArea
				label="Why you deserve it"
				required
				rows={2}
				value={request.reason}
				disabled={disabled}
				placeholder="A short reason. Link a staff approval or proof if you have one."
				onInput={(reason) => onChange({ ...request, reason })}
			/>
			<p class="pf-help so-note">Approved: your picks become your stats. Denied: your stats go back to the starting values.</p>
		</div>
	);
}

/** Asks on the page itself, since some browsers silently block confirm() pop-ups. */
function RemoveButton({ label, confirmLabel, onConfirm }: { label: string; confirmLabel: string; onConfirm: () => void }) {
	const [asking, setAsking] = useState(false);
	if (!asking)
		return (
			<button type="button" class="pf-button subtle" onClick={() => setAsking(true)}>
				{label}
			</button>
		);
	return (
		<span class="pf-confirm" role="group" aria-label={confirmLabel}>
			<span>{confirmLabel}</span>
			<button type="button" class="pf-button danger" onClick={onConfirm} autoFocus>
				Yes, remove
			</button>
			<button type="button" class="pf-button subtle" onClick={() => setAsking(false)}>
				Cancel
			</button>
		</span>
	);
}

/** One part of a system's panel. */
type Block =
	| { kind: 'intro' }
	| { kind: 'group'; label: string; title?: string }
	| { kind: 'claim' }
	| { kind: 'heavenly' }
	| { kind: 'psychic' }
	| { kind: 'description' }
	| { kind: 'override' }
	| { kind: 'skills' }
	| { kind: 'extras' }
	| { kind: 'progress' }
	/** What the system grows into (potentials.ts): requirements, what it gives, and its fields once open. */
	| { kind: 'potential'; id: string; title?: boolean }
	/** Cyberpunk's Cyberware slots (the card's 'Cyberware' group). */
	| { kind: 'cyberware' }
	/** Chainsaw Man's Blood Tank, DAP and healing, worked out from the card (its 'Blood & power' group). */
	| { kind: 'devil' }
	/** Chainsaw Man's Fear Point upgrades and Metamorphosis (its 'Fear Points' group). */
	| { kind: 'fear' }
	/** Fire Force's levels worked out: Manipulation / Power and Oxygen. */
	| { kind: 'fire' }
	/** Fire Force's Pyrokinetic Techniques, with the card's levels. */
	| { kind: 'techniques' }
	/** JoJo: Hamon or Spin upgrade ladders. */
	| { kind: 'tracks'; which: 'hamon' | 'spin' }
	/** JoJo: Stand Awakening and Mastery gauges. */
	| { kind: 'standGauges' }
	/** JoJo: the Stand Arrow roll, for a character without a Stand. */
	| { kind: 'arrow' }
	/** Tokyo Ghoul: what the sub-species and Kagune work out to. */
	| { kind: 'ghoul' }
	/** Tokyo Ghoul: GEP, Rc Tank upgrades and M-Rc. */
	| { kind: 'rcTank' }
	/** inFAMOUS: what the class and levels work out to. */
	| { kind: 'conduit' }
	/** inFAMOUS: Arc Rolls, evolution items and the moves Core Relays give (its 'Evolution items' group). */
	| { kind: 'items' }
	/** inFAMOUS: the Karma bar and rank (its 'Karma bar' group). */
	| { kind: 'karma' }
	/** Quirk: the Awakening tracker and log. */
	| { kind: 'awakenings' }
	/** Fire Force: the Adolla Links seen, with a Stigma holder's peek rolls. */
	| { kind: 'adollaLinks' }
	/** Fire Force: Tephrosis moving through its stages. */
	| { kind: 'tephrosisClock' }
	| { kind: 'ocular' };

interface PanelTab {
	id: string;
	label: string | ((f: Fields) => string);
	blocks: Block[];
	/** Only shown while this is true. */
	when?: (f: Fields) => boolean;
	/** Shown but locked until unlocked (see lockReason in SystemPanel). */
	lock?: 'barrier' | 'heavenly' | 'approval' | 'ocular';
	/** For an 'approval' lock: the field staff set to open it early, and what the lock says. */
	approval?: { key: string; note: string };
	/** A potential from potentials.ts: locked until the character reaches it. */
	potential?: string;
}

interface PanelDef {
	/** The system's section of the Index, under power-systems/. */
	index: string;
	/** The Index page listing its canon abilities. */
	canon?: string;
	/** What a new character starts with, from the system's Index overview. */
	intro: string;
	describe: { label: string; help: string };
	tabs: PanelTab[];
	/** Starting stats with one starting value show as fixed tiles, not inputs. */
	staticStart?: boolean;
	/** Put the Permission Based picks in this tab instead of a tab of their own. */
	extrasIn?: string;
}

const SKILLS_TAB: PanelTab = { id: 'skills', label: 'Skills', blocks: [{ kind: 'skills' }] };
const TREE_TAB: PanelTab = { id: 'tree', label: 'Skill Tree', blocks: [{ kind: 'progress' }] };
const potentialTab = (id: string, label: string): PanelTab => ({ id, label, potential: id, blocks: [{ kind: 'potential', id }] });
const jjkTechnique = (f: Fields) => f.start !== 'Cursed Energy Utilization only' && !heavenlyEffect(f.heavenlyRestriction, f)?.noTechnique;

// Each system's tabs, mirrored from its Index pages. Field groups come from systems.ts; any group
// not placed here is added to the first tab, so a new field is never lost.
const PANELS: Record<string, PanelDef> = {
	abilities: {
		index: 'abilities/overview/',
		intro: '4 Ability Tier Points to spend on your ability’s stats (you don’t have to use them all), and up to 2 Standard and 1 Ultimate skill. Each ability has its own points and moves.',
		describe: { label: 'Ability concept', help: 'What your ability is and how it works, in your own words.' },
		tabs: [
			{ id: 'main', label: 'Ability', blocks: [{ kind: 'intro' }, { kind: 'group', label: 'Ability' }, { kind: 'override' }, { kind: 'description' }] },
			SKILLS_TAB,
			potentialTab('metamorphosis', 'Metamorphosis'),
			potentialTab('overclocking', 'Overclocking'),
			potentialTab('underclocking', 'Underclocking'),
			TREE_TAB,
		],
	},
	quirk: {
		index: 'my-hero-academia/overview/',
		canon: 'my-hero-academia/canon-zone/',
		intro: '3 Quirk Tier Points to spend on Power and Range (you don’t have to use them all), and up to 3 Standard and 2 Ultimate skills. Each Quirk has its own points.',
		describe: { label: 'Quirk concept', help: 'What your Quirk does and how it works.' },
		tabs: [
			{ id: 'main', label: 'Quirk', blocks: [{ kind: 'intro' }, { kind: 'claim' }, { kind: 'group', label: 'Quirk' }, { kind: 'override' }, { kind: 'description' }] },
			SKILLS_TAB,
			{ id: 'awakening', label: 'Awakenings', potential: 'awakening', blocks: [{ kind: 'potential', id: 'awakening' }, { kind: 'awakenings' }] },
			potentialTab('variant', 'Instability & Variant'),
			TREE_TAB,
		],
	},
	'fire-force': {
		index: 'fire-force/overview/',
		canon: 'fire-force/canon-zone/',
		intro: 'Second Generations control existing fire and start at Pyrokinetic Manipulation level 0. Third Generations produce their own and get 8 Fire Force Tier Points, each raising a starting level by 1. Every Pyrokinetic follows a theme and sticks to it.',
		describe: { label: 'Pyrokinesis concept', help: 'How your fire works and the theme it follows.' },
		tabs: [
			{ id: 'main', label: 'Pyrokinesis', blocks: [{ kind: 'intro' }, { kind: 'claim' }, { kind: 'group', label: 'Pyrokinesis' }, { kind: 'group', label: 'Levels' }, { kind: 'fire' }, { kind: 'description' }] },
			SKILLS_TAB,
			// Taught in RP: opens the moment the character is approved.
			{
				id: 'techniques',
				label: 'Techniques',
				lock: 'approval',
				approval: { key: 'techniques', note: 'Every technique must be taught in RP, so this opens the moment your character is approved. Until then, see what they do.' },
				blocks: [{ kind: 'techniques' }, { kind: 'group', label: 'Techniques', title: 'What you’ve been taught' }],
			},
			{
				id: 'adolla',
				label: 'Adolla',
				blocks: [
					{ kind: 'potential', id: 'stigma', title: true },
					{ kind: 'adollaLinks' },
					{ kind: 'potential', id: 'burst', title: true },
					{ kind: 'potential', id: 'grace', title: true },
				],
			},
			{ id: 'tephrosis', label: 'Tephrosis', potential: 'tephrosis', blocks: [{ kind: 'potential', id: 'tephrosis' }, { kind: 'tephrosisClock' }], when: (f) => f.generation === 'Third' || f.generation === 'XO' },
			TREE_TAB,
		],
	},
	'jujutsu-kaisen': {
		index: 'jujutsu-kaisen/overview/',
		canon: 'jujutsu-kaisen/canon-characters/',
		intro: 'Roll your Cursed Energy here. Every other starting stat is the same for everyone, so there’s nothing to spend.',
		describe: { label: 'Concept', help: 'What your Cursed Technique does, or how your character fights with Cursed Energy alone.' },
		staticStart: true,
		extrasIn: 'ce',
		tabs: [
			{
				id: 'ce',
				label: 'Cursed Energy',
				blocks: [{ kind: 'intro' }, { kind: 'group', label: 'Cursed Energy', title: 'Your Cursed Energy' }, { kind: 'override' }, { kind: 'extras' }, { kind: 'group', label: 'Restrictions & tools', title: 'Binding Vows & Cursed Tools' }],
			},
			{
				id: 'ct',
				label: 'Cursed Technique',
				when: (f) => !heavenlyEffect(f.heavenlyRestriction, f)?.noTechnique,
				blocks: [{ kind: 'group', label: 'Start', title: 'Your start' }, { kind: 'claim' }, { kind: 'group', label: 'Cursed Technique', title: 'Technique stats' }, { kind: 'description' }, { kind: 'skills' }],
			},
			{ id: 'barrier', label: 'Barrier Techniques', lock: 'barrier', blocks: [{ kind: 'group', label: 'Barrier Techniques', title: 'Barrier Techniques' }] },
			{ id: 'oculars', label: 'Oculars', lock: 'ocular', blocks: [{ kind: 'ocular' }] },
			{ id: 'heavenly', label: 'Heavenly Restriction', lock: 'heavenly', blocks: [{ kind: 'group', label: 'Heavenly Restriction', title: '' }, { kind: 'heavenly' }] },
			TREE_TAB,
		],
	},
	jojo: {
		index: 'jojos-bizarre-adventure/overview/',
		canon: 'jojos-bizarre-adventure/canon-characters/',
		intro: 'You start with a Stand: 15 Stand Points across its six stats (a canon Stand keeps its canon stats). Its Esoteric Ability awakens with Stand Awakening, or from the start with Stand Prodigy. Hamon and Vampirism are learned in RP, or started with permission; Spin starts only with the Spinning Soul trait. Hamon and Vampirism never go together; Spin and a Stand go with either.',
		describe: { label: 'Concept', help: 'Your Stand’s look and ability, and how your character fights.' },
		tabs: [
			{
				id: 'main',
				label: (f) => (hasStand(f) ? 'Stand' : 'Start'),
				blocks: [{ kind: 'intro' }, { kind: 'group', label: 'Your card' }, { kind: 'claim' }, { kind: 'group', label: 'Stand' }, { kind: 'standGauges' }, { kind: 'group', label: 'Stand growth', title: '' }, { kind: 'arrow' }, { kind: 'description' }],
			},
			SKILLS_TAB,
			{ id: 'hamon', label: 'Hamon', potential: 'hamon', blocks: [{ kind: 'potential', id: 'hamon' }, { kind: 'tracks', which: 'hamon' }] },
			{ id: 'spin', label: 'Spin', potential: 'spin', blocks: [{ kind: 'potential', id: 'spin' }, { kind: 'tracks', which: 'spin' }, { kind: 'potential', id: 'goldenSpin', title: true }] },
			{ id: 'vampire', label: 'Vampire', potential: 'vampire', blocks: [{ kind: 'potential', id: 'vampire' }, { kind: 'potential', id: 'ulf', title: true }] },
			{ ...potentialTab('esoteric', 'Esoteric Ability'), when: hasStand },
			{ ...potentialTab('standEvolution', 'Stand Evolution'), when: hasStand },
			TREE_TAB,
		],
	},
	infamous: {
		index: 'infamous/overview/',
		canon: 'infamous/canon-area/',
		intro: 'Pick your Conduit class (any but Quantum; Meta needs permission). Elementals get 4 Conduit Tier Points and Energy Conduits 5, for any stat but Tank. Every Conduit gets +10 PTP. After that you evolve by absorbing Blast Shards, Cores and Relays.',
		describe: { label: 'Conduit concept', help: 'What your powers are and how they work.' },
		tabs: [
			{ id: 'main', label: (f) => (f.class ? String(f.class).replace('Biologically Enhanced', 'Bio-Enhanced') : 'Conduit'), blocks: [{ kind: 'intro' }, { kind: 'claim' }, { kind: 'group', label: 'Conduit' }, { kind: 'conduit' }, { kind: 'group', label: 'Levels' }, { kind: 'description' }] },
			SKILLS_TAB,
			// Evolution items come from Arc Rolls in RP: opens the moment the character is approved.
			{
				id: 'items',
				label: 'Evolution',
				lock: 'approval',
				approval: { key: 'blastShards', note: 'Evolution items are found with Arc Rolls in RP, so this opens the moment your character is approved. Until then, see what they give.' },
				blocks: [{ kind: 'items' }],
			},
			// Psychics: the people under their Mental Domination. They're taken over in RP, so it opens once approved.
			{
				id: 'mind',
				label: 'Mind',
				when: (f) => f.class === 'Psychic',
				lock: 'approval',
				approval: { key: 'puppets', note: 'Mental Domination happens in RP, so the people under your influence are tracked here once you’re approved. Until then, see how it works at your phase.' },
				blocks: [{ kind: 'psychic' }],
			},
			{ id: 'karma', label: 'Karma', blocks: [{ kind: 'group', label: 'Karma', title: '' }, { kind: 'karma' }] },
			{ ...potentialTab('karmaBomb', 'Karma Bomb'), when: (f) => ['Elemental', 'Energy', 'Meta', 'Quantum'].includes(String(f.class)) },
			TREE_TAB,
		],
	},
	'tokyo-ghoul': {
		index: 'tokyo-ghoul/overview/',
		intro: 'Humans fight with Quinques. Ghouls roll their Kagune type, start at 4C with no PTP, and live on Rc. One-Eyed starts need the Combo trait; Quinx are made by the CCG in RP.',
		describe: { label: 'Concept', help: 'Your Kagune or Quinque and how your character fights.' },
		tabs: [
			{ id: 'main', label: (f) => (isGhoul(f) ? 'Ghoul' : 'Human'), blocks: [{ kind: 'intro' }, { kind: 'group', label: 'Path' }, { kind: 'group', label: 'Kagune' }, { kind: 'ghoul' }, { kind: 'group', label: 'Quinque' }, { kind: 'description' }] },
			SKILLS_TAB,
			// GEP is earned in RP: opens the moment the character is approved.
			{
				id: 'rc',
				label: 'Rc Tank',
				when: (f) => hasKagune(f) && !isQuinx(f),
				lock: 'approval',
				approval: { key: 'gep', note: 'GEP and Mutated Rc are earned in RP, so this opens the moment your character is approved. Until then, see what they buy.' },
				blocks: [{ kind: 'rcTank' }],
			},
			{ id: 'kakuja', label: 'Kakuja', when: hasKagune, blocks: [{ kind: 'potential', id: 'kakuja', title: true }, { kind: 'potential', id: 'specialRc', title: true }] },
			{ id: 'subspecies', label: 'One-Eyed & Quinx', blocks: [{ kind: 'potential', id: 'oneEyed', title: true }, { kind: 'potential', id: 'quinx', title: true }] },
			TREE_TAB,
		],
	},
	'chainsaw-man': {
		index: 'chainsaw-man/overview/',
		intro: 'Devils, Fiends and Hybrids are built around a feared concept. Humans and Hybrids make contracts with Devils.',
		describe: { label: 'Concept', help: 'Your Devil’s concept, or how your character uses their contracts.' },
		tabs: [
			{ id: 'main', label: (f) => (f.path === 'Human with contracts' ? 'Human' : String(f.path || 'Devil')), blocks: [{ kind: 'intro' }, { kind: 'group', label: 'Path & nature' }, { kind: 'devil' }, { kind: 'description' }] },
			// Fiends can't make contracts.
			{ id: 'contracts', label: 'Contracts', when: (f) => ['Human with contracts', 'Hybrid'].includes(String(f.path)), blocks: [{ kind: 'group', label: 'Contracts' }] },
			// Fear Points are earned in RP: opens the moment the character is approved.
			{
				id: 'fear',
				label: 'Fear & Evolution',
				when: (f) => f.path === 'Devil',
				lock: 'approval',
				approval: { key: 'fearPoints', note: 'Fear Points are earned in RP, so this opens the moment your character is approved. Until then, see what they buy.' },
				blocks: [{ kind: 'fear' }],
			},
			SKILLS_TAB,
			TREE_TAB,
		],
	},
	cyberpunk: {
		index: 'cyberpunk-2077/overview/',
		intro: 'Made for powerless builds. A powered start tracks Street Cred; an unpowered start also unlocks the Mastery System, with XP and Skill Points.',
		describe: { label: 'Concept', help: 'Your character’s build and how they fight.' },
		tabs: [
			{ id: 'main', label: 'Start', blocks: [{ kind: 'intro' }, { kind: 'group', label: 'Start & progress' }, { kind: 'description' }] },
			// Locked at the start; opens the moment the character is approved.
			{ id: 'cyberware', label: 'Cyberware', lock: 'approval', blocks: [{ kind: 'cyberware' }] },
			// The Mastery System's Skill Tree is for unpowered starts.
			{ ...TREE_TAB, when: (f) => f.start === 'Unpowered' },
		],
	},
};

const isUpgradeField = (f: Field) => f.key.toLowerCase().includes('upgradepoints');

/** The open card: the system's own tabs, each built from blocks. */
function SystemPanel(props: Props & { entry: SystemEntry; def: SystemDef; tab: string; setTab: (id: string) => void; limitedChoiceFull: (e: SystemEntry) => boolean }) {
	const { entry, def, sheet, update, readOnly } = props;
	const setEntry = (fn: (e: SystemEntry) => void) =>
		update((s) => {
			const e = s.systems.find((x) => x.key === entry.key);
			if (e) fn(e);
		});
	const panel: PanelDef = PANELS[def.id] ?? {
		index: '',
		intro: '',
		describe: { label: 'Description', help: 'What this is and how it works.' },
		tabs: [{ id: 'main', label: def.label, blocks: [{ kind: 'group', label: '' }, { kind: 'description' }] }, SKILLS_TAB, TREE_TAB],
	};
	const f = entry.fields;
	// Admin characters open everything, like the dev preview's ?all.
	const free = Boolean(props.adminCharacter);
	const unlock = Boolean(props.unlockAll) || free;
	const unlockedText = free ? 'Open on an admin character.' : 'Unlocked for testing.';

	// Locks, as on every card: family abilities, wallet-tracked points, a Heavenly Restriction, staff values.
	const linked = Boolean(entry.familyLink);
	const linkedAbility = entry.familyLink && props.familyAbilities?.find((p) => p.id === entry.familyLink!.perkId)?.details.ability;
	const own = linkedAbility ? memberKeys(def, linkedAbility) : [];
	const tracked = (key: string) => Boolean(props.trackedCards?.has(entry.key)) && isTrackedField(entry.system, key);
	const effect = entry.system === 'jujutsu-kaisen' ? heavenlyEffect(f.heavenlyRestriction, f) : null;
	// With a stat override (and no restriction granted to the account), a Heavenly Restriction can be asked for here.
	const heavenlyAsk = Boolean(entry.statOverride) && !props.isEvolution && !linked && !props.heavenlyGrant && entry.system === 'jujutsu-kaisen';
	const heavenlyLocked = (key: string) => (key === 'heavenlyRestriction' && !unlock && !heavenlyAsk && (props.isEvolution || props.heavenlyGrant !== null || !effect)) || Boolean(effect && key in effect.fixed);
	const staffSet = (key: string) => Boolean(props.staffOverrides?.[cardPath(entry.key, key)]);
	const setByRoll = (key: string) => !free && Boolean(def.fields.find((x) => x.key === key)?.setByRoll) && !staffSet(key);
	// A canon Quirk's class and Quirk Factor are fixed, and so is a Pillar Ignition's Adolla Burst.
	const canonFixed: Fields = (() => {
		if (linked || !['quirk', 'fire-force', 'jojo', 'infamous'].includes(def.id)) return {};
		const claim = canonClaimFor(sheet, entry, props.requestedClaims, props.claimBoard);
		if (def.id === 'fire-force') return canonIgnition(claim);
		if (def.id === 'infamous') return canonConduitFields(claim?.name);
		// A canon Stand's stats and Esoteric Ability.
		if (def.id === 'jojo') {
			const stand = canonStand(claim?.name);
			return stand ? { ...canonStandFields(claim!.name), esotericName: '', esotericAbility: stand.ability } : {};
		}
		const q = canonQuirk(claim?.name);
		return q ? { type: q.class, ...(q.factor ? { factor: q.factor } : {}) } : {};
	})();
	const canonHelp = def.id === 'fire-force' ? 'Set by your canon Ignition.' : def.id === 'jojo' ? 'Set by your canon Stand.' : def.id === 'infamous' ? 'Set by your canon Conduit.' : 'Set by your canon Quirk.';
	const fieldLocked = (key: string) => key in canonFixed || setByRoll(key) || readOnly || (linked && !own.includes(key)) || tracked(key) || heavenlyLocked(key) || staffSet(key);
	const skillsLocked = readOnly || (linked && (!linkedAbility || familyScope(def, linkedAbility).skills));
	const canOverride = !props.isEvolution && !linked;
	// How the character's traits change this system's start, shown above the tabs.
	const traitEffects = linked ? [] : traitEffectsFor(sheet, entry.system, props.combos);
	const startHeld = canOverride && !entry.statOverride;
	// Without a stat override, choices that would spend past the starting points are locked.
	const budgetLocked = startHeld && Boolean(def.budget);
	const spentNow = budgetLocked ? (systemBudget(sheet, entry)?.spent ?? 0) : 0;
	const overBudget = (key: string, v: string) => {
		const b = systemBudget(sheet, { ...entry, fields: { ...f, [key]: v } });
		return Boolean(b && b.spent > b.total && b.spent > spentNow);
	};
	// An admin character types its Cursed Energy in instead of rolling it.
	const rollOpen =
		!free &&
		(!linked || own.some((k) => def.fields.find((x) => x.key === k)?.rolled)) && !(effect && 'ceClass' in effect.fixed) && !props.staffOverrides?.[cardPath(entry.key, 'ceClass')];
	const claimable = Boolean(def.universe && def.claimLabel) && !effect?.noTechnique && (def.id !== 'jujutsu-kaisen' || jjkTechnique(f)) && (def.id !== 'jojo' || hasStand(f));
	const universe = props.universes.find((u) => u.slug === def.universe);

	const groups = groupedFields(def, f);
	const extraLabels = [EXTRAS_GROUP, ...(def.extras ?? []).map((x) => x.label)];
	const potentials = potentialsFor(def.id);
	const placed = new Set([...panel.tabs.flatMap((t) => t.blocks.flatMap((b) => (b.kind === 'group' ? [b.label] : []))), ...extraLabels, ...potentials.map((p) => p.group), ...(panel.tabs.some((t) => t.blocks.some((b) => b.kind === 'cyberware')) ? ['Cyberware'] : []), ...(def.id === 'chainsaw-man' ? ['Blood & power', 'Fear Points'] : []), ...(def.id === 'jojo' ? ['Upgrades', 'Canon Stand'] : []), ...(def.id === 'tokyo-ghoul' ? ['Rc Tank'] : []), ...(def.id === 'infamous' ? ['Evolution items', 'Karma bar', 'Mental Domination'] : []), ...(def.id === 'fire-force' ? ['Technique log', 'Adolla Links', 'Tephrosis clock'] : []), ...(def.id === 'jujutsu-kaisen' ? [OCULAR_GROUP] : [])]);
	const unplaced = groups.filter((g) => !placed.has(g.label)).map((g) => g.label);
	// Permission Based starts get their own tab, before the skills.
	const extrasTab: PanelTab[] = def.extras?.length && !panel.extrasIn ? [{ id: 'extras', label: EXTRAS_GROUP, blocks: [{ kind: 'extras' }] }] : [];
	// Before the skills, or after the first tab when there are none.
	const skillsTab = panel.tabs.findIndex((t) => t.blocks.some((b) => b.kind === 'skills'));
	const skillsAt = skillsTab < 0 ? 1 : skillsTab;
	const tabs = [...panel.tabs.slice(0, skillsAt), ...extrasTab, ...panel.tabs.slice(skillsAt)]
		.map((t, i) => (i === 0 && unplaced.length ? { ...t, blocks: [...t.blocks, ...unplaced.map((label): Block => ({ kind: 'group', label }))] } : t))
		.filter((t) => !t.when || t.when(f));
	const picked = Array.isArray(f[EXTRAS_KEY]) ? (f[EXTRAS_KEY] as string[]) : [];
	const current = tabs.find((t) => t.id === props.tab) ?? tabs[0];
	const labelOf = (t: PanelTab) => (typeof t.label === 'function' ? t.label(f) : t.label);
	const barrierNatural = def.id !== 'jujutsu-kaisen' ? null : unlock ? unlockedText : barrierUnlocked(sheet, entry, { isEvolution: props.isEvolution, staffOverrides: props.staffOverrides });
	// A stat override can ask to start with Barrier Techniques too.
	const barrierAsk = def.id === 'jujutsu-kaisen' && !barrierNatural && Boolean(entry.statOverride) && canOverride;
	const barrierOpen = barrierNatural ?? (barrierAsk ? 'Opened by your stat override request.' : null);
	const potentialCtx = { ...potentialCtxOf(sheet, props.combos), isEvolution: props.isEvolution, staffOverrides: props.staffOverrides };
	// Rolls made on this card's tabs after approval (e.g. Quirk Instability).
	const evolution = props.roller.evolution;
	const cardRolls = evolution?.rolls.filter((r) => r.card_key === entry.key);
	const unstable = def.id === 'quirk' && Boolean(cardRolls && quirkRollStage(cardRolls).stage === 'unstable');
	const potentialOf = (id: string) => {
		const p = potentials.find((x) => x.id === id);
		if (!p) return null;
		const state = unlock ? { ...potentialState(p, entry, potentialCtx), open: true, reason: unlockedText } : potentialState(p, entry, potentialCtx);
		// Once unstable, the Variant roll stays open even if the requirements changed since.
		return { p, state: p.id === 'variant' && unstable && !state.open ? { ...state, open: true, reason: 'Your Quirk is unstable. Roll for Spontaneous Evolution below.' } : state };
	};
	/** Puts a roll's result on the card: a Variant (all Quirk stats reset to the bottom) or an Awakening. */
	const applyRoll = (r: EvolutionRoll) =>
		setEntry((e) => {
			const variant = VARIANT_OF[r.result];
			if (variant) Object.assign(e.fields, { variant, power: 'No Power', range: 'Physical' });
			if (r.result === 'awakening') Object.assign(e.fields, withAwakenings(e.fields, [...awakeningLog(e.fields), newAwakening('Spontaneous Evolution')]));
		});
	/** Why a tab is locked, or null when it's open. */
	// The Ocular spot on the claim board (claim_type 'ocular'), and whether this character asked for or holds one.
	const ocularSpot = def.id === 'jujutsu-kaisen' ? props.claimBoard.find((r) => r.claim_type === 'ocular' && r.universe === def.universe) : undefined;
	const ocularAsked = Boolean(ocularSpot && props.requestedClaims.includes(ocularSpot.id));
	const ocularHeld = Boolean(ocularSpot && props.heldClaims.has(ocularSpot.id));
	const lockReason = (t: PanelTab): string | null => {
		if (t.lock === 'ocular' && !free && !ocularAsked && ocularSpots(ocularSpot, false, ocularHeld)?.full) return 'All Ocular Spots are taken';
		if (unlock) return null;
		if (t.potential) {
			const pot = potentialOf(t.potential);
			return pot && !pot.state.open ? pot.state.reason : null;
		}
		if (t.lock === 'barrier' && !barrierOpen)
			return 'New characters start without Barrier Techniques. They unlock with the Barrier Prodigy trait, a family ability that includes them, or when staff unlock them for you. After approval you learn them with BTUP.';
		if (t.lock === 'approval' && !props.isEvolution && !staffSet(t.approval?.key ?? 'cyberware'))
			return t.approval?.note ?? 'Cyberware is obtained in RP, so it opens the moment your character is approved. Until then, browse what fits each slot.';
		if (t.lock === 'heavenly' && !effect && !props.heavenlyGrant && !heavenlyAsk)
			return 'A Heavenly Restriction is granted by staff to your account. Once it is, it’s applied here automatically.';
		return null;
	};
	const locked = lockReason(current);

	/** A starting stat that's the same for everyone: shown as a fixed value instead of an input. */
	const valueText = (x: Field, v: unknown) => JJK_LEVEL_OPTIONS[x.key]?.find((o) => o.value === String(v))?.label ?? x.options?.find((o) => o.value === String(v))?.label ?? String(v);

	const fieldInput = (field: Field) => (
		<FieldInput
			key={field.key}
			field={field.key in canonFixed ? { ...field, help: canonHelp, ...(field.options && !field.options.some((o) => o.value === String(canonFixed[field.key])) ? { options: [...field.options, { value: String(canonFixed[field.key]) }] } : {}) } : staffSet(field.key) ? { ...field, help: 'Set by staff.' } : tracked(field.key) ? { ...field, help: TRACKED_HELP } : field}
			value={field.key in canonFixed ? canonFixed[field.key] : f[field.key]}
			disabled={fieldLocked(field.key) || (Boolean(field.rolled) && !free)}
			free={free}
			blocked={def.limitedChoice?.key === field.key && props.limitedChoiceFull(entry) ? { value: def.limitedChoice.value, reason: 'max reached' } : undefined}
			atStart={startHeld}
			overBudget={budgetLocked ? (v) => overBudget(field.key, v) : undefined}
			lockPermission={startHeld}
			traits={sheet.traits.map((t) => t.name)}
			onChange={(v) => {
				if (field.key === 'heavenlyRestriction' && heavenlyAsk) {
					update((s) => {
						const e = s.systems.find((x) => x.key === entry.key);
						if (!e) return;
						if (isHeavenly(v)) {
							applyHeavenly(s, v, () => entry.key, () => ({}), (p) => Boolean(props.staffOverrides?.[p]));
							e.statOverride = { reason: '', ...e.statOverride, heavenly: e.statOverride?.heavenly ?? '' };
						} else {
							e.fields.heavenlyRestriction = v;
							if (e.statOverride) delete e.statOverride.heavenly;
						}
					});
					return;
				}
				setEntry((e) => {
					e.fields[field.key] = v;
					// A Devil's Blood Tank and DAP follow its class and path.
					if (def.id === 'chainsaw-man') Object.assign(e.fields, deriveDevil(e.fields));
					// e.g. switching a JJK card to Cursed Energy Utilization only lowers its starting skills.
					if (field.key === 'start') lockPastStart(e, def.startingMoves?.(e.fields), props.isEvolution);
				});
			}}
			onUpdate={(fn) => setEntry((e) => void (e.fields[field.key] = fn(e.fields[field.key])))}
		/>
	);

	const block = (b: Block, i: number) => {
		switch (b.kind) {
			case 'intro':
				if (!panel.intro && !def.notes?.length) return null;
				return (
					<div class="sp-intro pf-wide" key={i}>
						{panel.intro && <p>{panel.intro}</p>}
						{def.notes && def.notes.length > 0 && (
							<ul>
								{def.notes.map((n) => (
									<li key={n}>{n}</li>
								))}
							</ul>
						)}
					</div>
				);
			case 'group': {
				// Barrier Techniques: one card each, with the stats that belong to each inside it.
				if (b.label === BARRIER_GROUP) {
					const statField = (key: string) => def.fields.find((x) => x.key === key);
					return (
						<div class="sp-group pf-wide" key={i}>
							<h4 class="pf-subhead">{b.title ?? b.label}</h4>
							{barrierOpen && !barrierAsk && <p class="pf-help sp-unlocked">{barrierOpen}</p>}
							{barrierAsk && (
								<div class="so-inline">
									<span class="so-kicker">Stat override · staff review</span>
									<TextArea
										label="Why should you start with Barrier Techniques?"
										required
										rows={3}
										help="New characters start without them. Staff read this with your override."
										value={entry.statOverride?.barrier ?? ''}
										disabled={readOnly}
										onInput={(barrier) => setEntry((e) => void (e.statOverride = { reason: '', ...e.statOverride, barrier }))}
									/>
								</div>
							)}
							<BarrierList
								list={(Array.isArray(f.barrierTechniques) ? f.barrierTechniques : []) as unknown as BarrierEntry[]}
								canEdit={!fieldLocked('barrierTechniques')}
								onChange={(list) =>
									setEntry((e) => {
										e.fields.barrierTechniques = list as unknown as FieldValue;
										// A technique's stats start at their starting value.
										for (const key of list.flatMap((t) => BARRIER_KINDS.find((k) => k.name === t.kind)?.stats ?? [])) {
											const x = statField(key);
											if (x && (e.fields[key] === undefined || e.fields[key] === '') && x.default !== undefined) e.fields[key] = x.default;
										}
									})
								}
								stat={(key) => {
									const x = statField(key);
									return x ? fieldInput(x) : null;
								}}
								statText={(key) => {
									const x = statField(key);
									if (!x) return null;
									const v = f[key];
									const text = valueText(x, v === undefined || v === '' ? (x.default ?? '') : v);
									return text ? `${x.label.replace(/^Domain (?=Amplification)/, '')}: ${text}` : null;
								}}
							/>
						</div>
					);
				}
				const group = b.label ? groups.find((g) => g.label === b.label) : { label: '', fields: visibleFields(def, f) };
				if (!group) return null;
				const roll = rollOpen && group.fields.some((x) => x.rolled === 'cursed_energy');
				const canon = Boolean(canonClaimFor(sheet, entry, props.requestedClaims, props.claimBoard));
				const shown = group.fields.filter((x) => !isUpgradeField(x) && !(x.rolled && roll) && !(canon && x.key === 'name') && !(x.key === 'theme' && 'theme' in canonFixed));
				if (!shown.length && !roll) return null;
				const lists = shown.filter((x) => x.type === 'list' || x.type === 'textarea');
				const short = shown.filter((x) => !lists.includes(x));
				const held = startHeld && short.some((x) => x.startsAt !== undefined);
				const heading = b.title ?? b.label;
				return (
					<div class="sp-group pf-wide" key={i}>
						{heading && <h4 class="pf-subhead">{heading}</h4>}
						{roll && (
							<RollPanel
								kind="cursed_energy"
								record={props.roller.characterRolls.cursed_energy}
								current={f.ceClass ? { class: String(f.ceClass), cep: Number(f.ceAmount) || 0, level: String(f.ceLevel ?? '') } : null}
								characterId={props.roller.characterId}
								myRolls={props.roller.myRolls}
								ensureSaved={props.roller.ensureSaved}
								refresh={props.roller.refresh}
								readOnly={readOnly}
								onRolled={(r) =>
									update((s) => {
										for (const e of s.systems) {
											if (e.system !== entry.system) continue;
											e.fields.ceClass = r.class ?? '';
											e.fields.ceAmount = r.cep ?? 0;
											e.fields.ceLevel = r.level ?? '';
										}
									})
								}
								onCleared={() =>
									update((s) => {
										for (const e of s.systems) {
											if (e.system !== entry.system) continue;
											e.fields.ceClass = '';
											e.fields.ceAmount = 0;
											e.fields.ceLevel = '';
										}
									})
								}
							/>
						)}
						{held && panel.staticStart && <p class="pf-help sp-stats-note">Everyone starts at the same stats: the rest open with a stat override (top of the card), or as you train after approval.</p>}
						{short.length > 0 && <div class="sp-fields">{short.map(fieldInput)}</div>}
						{lists.map(fieldInput)}
					</div>
				);
			}
			case 'claim':
				if (!claimable) return null;
				return (
					<div class="pf-wide" key={i}>
						<ClaimPicker
							universe={def.universe!}
							label={universe?.ability_label ? `Canon ${universe.ability_label}` : def.claimLabel!}
							board={props.claimBoard}
							picked={props.requestedClaims}
							held={props.heldClaims}
							free={free}
							disabled={readOnly}
							onChange={(ids) => {
								props.setRequestedClaims(ids);
								// A canon ability goes by its canon name.
								const canon = props.claimBoard.find((r) => ids.includes(r.id) && r.universe === def.universe && r.claim_type === 'ability');
								if (canon)
									setEntry((e) => {
										delete e.fields.name;
										// A canon Quirk comes with its class and Quirk Factor.
										const q = def.id === 'quirk' ? canonQuirk(canon.name) : undefined;
										if (q) Object.assign(e.fields, { type: q.class, ...(q.factor ? { factor: q.factor } : {}) });
										// A Pillar's Ignition comes with its Adolla Burst.
										if (def.id === 'fire-force') Object.assign(e.fields, canonIgnition(canon));
										// A canon Conduit comes with its class and element.
										if (def.id === 'infamous') Object.assign(e.fields, canonConduitFields(canon.name));
										// A canon Stand comes with its canon stats.
										if (def.id === 'jojo') {
											if (canonStand(canon.name)) Object.assign(e.fields, canonStandFields(canon.name), { hasStand: 'Yes', standName: canon.name, canonStand: canon.name });
											else delete e.fields.canonStand;
										}
									});
								// Without a canon Stand, the card goes back to its own stats.
								else if (def.id === 'jojo' && f.canonStand) setEntry((e) => void delete e.fields.canonStand);
							}}
						/>
					</div>
				);
			case 'heavenly': {
				const asking = heavenlyAsk && entry.statOverride?.heavenly !== undefined;
				if (!effect || !f.heavenlyRestriction) {
					return heavenlyAsk ? (
						<p class="pf-help pf-wide" key={i}>
							Opened by your stat override request. Pick the Heavenly Restriction you’re applying for.
						</p>
					) : null;
				}
				return (
					<div class={`pf-wide ${asking ? 'so-inline' : 'hr-perks'}`} key={i}>
						{asking && <span class="so-kicker">Stat override · staff review</span>}
						<strong>{asking ? `You’re applying for: ${String(f.heavenlyRestriction)} Heavenly Restriction` : `${String(f.heavenlyRestriction)} Heavenly Restriction`}</strong>
						<ul>
							{effect.perks.map((p) => (
								<li key={p}>{p}</li>
							))}
						</ul>
						{asking && (
							<TextArea
								label={`Why should you start with ${String(f.heavenlyRestriction)}?`}
								required
								rows={3}
								help="Heavenly Restrictions are normally granted by staff. They read this with your override."
								value={entry.statOverride?.heavenly ?? ''}
								disabled={readOnly}
								onInput={(heavenly) => setEntry((e) => void (e.statOverride = { reason: '', ...e.statOverride, heavenly }))}
							/>
						)}
					</div>
				);
			}
			case 'description': {
				// A canon ability's blurb is on its canon card instead.
				const canonPick = linked ? undefined : canonClaimFor(sheet, entry, props.requestedClaims, props.claimBoard);
				if (canonBlurb(canonPick) || (def.id === 'jojo' && canonStand(canonPick?.name))) return null;
				return (
					<div class="pf-wide" key={i}>
						<TextArea
							label={linked ? 'How your character uses this ability' : panel.describe.label}
							help={linked ? 'Your character’s take on the family ability, in your own words.' : panel.describe.help}
							rows={4}
							value={entry.description}
							disabled={readOnly}
							onInput={(v) => setEntry((e) => void (e.description = v))}
						/>
					</div>
				);
			}
			case 'override':
				// The stat override is asked for from the card's top bar.
				return null;
			case 'skills':
				return (
					<div class="pf-wide" key={i}>
						<SkillsEditor
							skills={entry.skills}
							disabled={skillsLocked}
							limits={def.startingMoves?.(f)}
							defaults={def.defaultMoves?.(f)}
							defaultsFrom={def.id === 'infamous' ? `Every ${String(f.class)} Conduit` : undefined}
							isEvolution={props.isEvolution}
							noLimits={Boolean(props.adminCharacter)}
							isTreeActive={Boolean(entry.customTree)}
							tree={entry.customTree}
							onUpdate={(fn) =>
								setEntry((e) => {
									const prev = e.skills || [];
									const next = fn(prev);
									e.skills = next;
									if (e.customTree && Array.isArray(e.customTree.nodes)) syncSkillsToTree(e.customTree, prev, next);
									lockPastStart(e, def.startingMoves?.(e.fields), props.isEvolution);
								})
							}
						/>
					</div>
				);
			case 'extras': {
				const pick = def.fields.find((x) => x.key === EXTRAS_KEY);
				if (!pick) return null;
				const canPick = !fieldLocked(EXTRAS_KEY);
				const toggle = (label: string) =>
					setEntry((e) => {
						const now = Array.isArray(e.fields[EXTRAS_KEY]) ? (e.fields[EXTRAS_KEY] as string[]) : [];
						e.fields[EXTRAS_KEY] = now.includes(label) ? now.filter((x) => x !== label) : [...now, label];
					});
				return (
					<Fragment key={i}>
						<div class="pb pf-wide">
							<div class="pb-head">
								<div class="pb-title">
									<span class="pb-key" aria-hidden="true">
										<KeyIcon />
									</span>
									<h4 class="pf-subhead">Permission Based starts</h4>
								</div>
								<p class="pf-help">Rare starts staff have to allow. Switch on the ones you’ve been given; staff confirm them when they approve your character.</p>
							</div>
							{(def.extras ?? []).map((x) => {
								const on = picked.includes(x.label);
								const shown = (groups.find((g) => g.label === x.label)?.fields ?? []).filter((fl) => !isUpgradeField(fl));
								const long = shown.filter((fl) => fl.type === 'list' || fl.type === 'textarea' || fl.type === 'multiselect');
								const short = shown.filter((fl) => !long.includes(fl));
								return (
									<div class={`pb-row${on ? ' on' : ''}`} key={x.label}>
										<label class="pb-line">
											<strong class="pb-name">{x.label}</strong>
											<span class="pb-about">{x.about}</span>
											<span class="pb-switch">
												<input type="checkbox" role="switch" checked={on} disabled={!canPick} onChange={() => toggle(x.label)} />
												<span class="pb-track" aria-hidden="true" />
												<span class="pb-state">{on ? 'Asked' : 'Ask'}</span>
											</span>
										</label>
										{on && (
											<div class="pb-fields">
												{short.length > 0 && <div class="sp-fields">{short.map(fieldInput)}</div>}
												{long.map(fieldInput)}
											</div>
										)}
									</div>
								);
							})}
						</div>
					</Fragment>
				);
			}
			case 'cyberware':
				return (
					<CyberwareBay
						key={i}
						pieces={piecesOf(f)}
						slots={slotsOf(f)}
						locked={lockReason(current)}
						readOnly={readOnly}
						onChange={(pieces, extraSlots) =>
							setEntry((e) => {
								e.fields.cyberware = pieces as unknown as FieldValue;
								e.fields.extraSlots = extraSlots;
							})
						}
					/>
				);
			case 'tracks': {
				const hamon = b.which === 'hamon';
				const reached = hamon ? hasHamon(f) : hasSpin(f);
				if (!reached) return null;
				const tracks = hamon ? HAMON_TRACKS : SPIN_TRACKS;
				const canEdit = !readOnly && (props.isEvolution || tracks.some((t) => staffSet(t.key)));
				return <UpgradeTracks key={i} tracks={tracks} fields={f} points={hamon ? 'HUP' : 'SUP'} canEdit={canEdit} onChange={(key, level) => setEntry((e) => void (e.fields[key] = level))} />;
			}
			case 'standGauges':
				return hasStand(f) ? <StandGauges key={i} fields={f} /> : null;
			case 'arrow':
				if (hasStand(f)) return null;
				return (
					<ArrowRolls
						key={i}
						rolls={cardRolls?.filter((r) => r.kind === 'stand_arrow')}
						roll={evolution && props.isEvolution ? () => evolution.roll(entry.key, 'stand_arrow') : undefined}
						readOnly={readOnly}
					/>
				);
			case 'ghoul':
				return <GhoulStats key={i} fields={f} />;
			case 'rcTank':
				return <RcTank key={i} fields={f} locked={lockReason(current)} readOnly={readOnly || ['gep', 'tankUpgrades'].some(staffSet)} onChange={(patch) => setEntry((e) => void Object.assign(e.fields, patch))} />;
			case 'conduit':
				return <ConduitStats key={i} fields={f} />;
			case 'psychic':
				return <PsychicMind key={i} fields={f} locked={lockReason(current)} readOnly={readOnly || fieldLocked('puppets')} onChange={(puppets) => setEntry((e) => void (e.fields.puppets = puppets as unknown as FieldValue))} />;
			case 'awakenings': {
				const pot = potentialOf('awakening');
				return (
					<AwakeningLog
						key={i}
						fields={f}
						canAdd={Boolean(pot?.state.open) && (props.isEvolution || unlock)}
						readOnly={readOnly || staffSet('awakenings')}
						approvedCount={0}
						onChange={(log) => setEntry((e) => void Object.assign(e.fields, withAwakenings(e.fields, log)))}
					/>
				);
			}
			case 'items':
				return (
					<EvolutionItems
						key={i}
						fields={f}
						locked={lockReason(current)}
						readOnly={readOnly}
						onChange={(patch) => setEntry((e) => void Object.assign(e.fields, patch))}
						rolls={cardRolls?.filter((r) => r.kind === 'arc_roll')}
						roll={evolution && props.isEvolution ? () => evolution.roll(entry.key, 'arc_roll') : undefined}
					/>
				);
			case 'karma':
				return (
					<KarmaBar
						key={i}
						fields={f}
						locked={!props.isEvolution && !staffSet('karmaPoints') ? 'Karma is earned in RP, so the bar opens the moment your character is approved.' : null}
						readOnly={readOnly}
						onChange={(patch) => setEntry((e) => void Object.assign(e.fields, patch))}
					/>
				);
			case 'fire':
				return <FireStats key={i} fields={f} />;
			case 'techniques':
				return (
					<TechniqueGuide
						key={i}
						fields={f}
						stamina={String(sheet.stats.stamina ?? '')}
						canLog={!readOnly && (props.isEvolution || unlock || staffSet('techniques'))}
						onLog={(log) => setEntry((e) => void Object.assign(e.fields, withTechniques(e.fields, log)))}
					/>
				);
			case 'adollaLinks':
				return (
					<AdollaLinks
						key={i}
						fields={f}
						canAdd={!readOnly && (props.isEvolution || unlock)}
						rolls={cardRolls?.filter((r) => r.kind === 'adolla_peek')}
						roll={evolution && props.isEvolution ? () => evolution.roll(entry.key, 'adolla_peek') : undefined}
						rpMs={evolution?.rpMs}
						onChange={(links: LinkEntry[]) => setEntry((e) => void (e.fields.adollaLinks = links as unknown as FieldValue))}
					/>
				);
			case 'ocular':
				return (
					<OcularPanel
						key={i}
						spot={ocularSpot}
						asked={ocularAsked}
						held={ocularHeld}
						fields={f}
						readOnly={readOnly}
						upload={props.uploadImage}
						onAsk={(ask) => {
							if (!ocularSpot) return;
							props.setRequestedClaims(ask ? [...props.requestedClaims, ocularSpot.id] : props.requestedClaims.filter((id) => id !== ocularSpot.id));
							if (!ask) setEntry((e) => void OCULAR_KEYS.forEach((k) => delete e.fields[k]));
						}}
						onChange={(patch) => setEntry((e) => void Object.assign(e.fields, patch))}
					/>
				);
			case 'tephrosisClock': {
				const pot = potentialOf('tephrosis');
				return (
					<TephrosisClock
						key={i}
						fields={f}
						canStart={!readOnly && Boolean(pot?.state.open) && (props.isEvolution || unlock)}
						hasAdaptation={sheet.traits.some((t) => t.name === ADAPTATION_TRAIT)}
						readOnly={readOnly || staffSet('tephrosis')}
						rpMs={evolution?.rpMs}
						onChange={(patch) => setEntry((e) => void Object.assign(e.fields, patch))}
					/>
				);
			}
			case 'devil':
				return <DevilStats key={i} fields={f} />;
			case 'fear':
				return (
					<FearUpgrades
						key={i}
						fields={f}
						locked={lockReason(current)}
						readOnly={readOnly || ['fearPoints', 'devilClass'].some(staffSet)}
						isEvolution={props.isEvolution}
						onChange={(patch) => setEntry((e) => void Object.assign(e.fields, patch, deriveDevil({ ...e.fields, ...patch })))}
					/>
				);
			case 'potential': {
				const pot = potentialOf(b.id);
				if (!pot) return null;
				return (
					<Fragment key={i}>
						{b.title && <h4 class={`pf-subhead pf-wide sp-pot-title${pot.state.open ? '' : ' locked'}`}>{!pot.state.open && <LockIcon />}{pot.p.label}</h4>}
						<p class={`pf-help pf-wide${pot.state.open ? ' sp-unlocked' : ''}`}>{pot.state.reason}</p>
						<PotentialInfo {...pot} fields={f} />
						{def.id === 'quirk' && pot.p.id === 'variant' && (!pot.p.reached(f) || Boolean(cardRolls?.length)) && (
							<QuirkRolls
								done={pot.p.reached(f)}
								rolls={cardRolls}
								roll={evolution && ((kind) => evolution.roll(entry.key, kind))}
								ready={unlock || unstable || pot.state.requirements.every((r) => r.status !== 'unmet')}
								readOnly={readOnly}
								onResult={applyRoll}
								rpMs={evolution?.rpMs}
							/>
						)}
						{def.id === 'abilities' && pot.p.id === 'overclocking' && pot.p.reached(f) && (
							<OverclockRolls
								rolls={cardRolls?.filter((r) => r.kind === 'overclock_instability')}
								roll={evolution && (() => evolution.roll(entry.key, 'overclock_instability'))}
								upgrades={Number(f.overclockUpgrades) || 0}
								readOnly={readOnly}
							/>
						)}
						{/* Fields a roll fills in (a Variant) show once there's something in them. Awakenings and Tephrosis have their own trackers. */}
						{pot.state.open && pot.p.id !== 'awakening' && pot.p.id !== 'tephrosis' && (pot.p.reached(f) || !pot.p.keys.every((k) => { const x = def.fields.find((d) => d.key === k); return x?.setByRoll || x?.showIf; }) || staffSet(pot.p.keys[0])) &&
							block({ kind: 'group', label: pot.p.group, title: '' }, i + 1000)}
					</Fragment>
				);
			}
			case 'progress': {
				// BTUP only matters once Barrier Techniques are unlocked.
				const upgrades = visibleFields(def, f).filter((x) => isUpgradeField(x) && !(x.key === 'btUpgradePoints' && !barrierOpen));
				return (
					<Fragment key={i}>
						{upgrades.length > 0 && (
							<div class="sp-group pf-wide">
								<h4 class="pf-subhead">Upgrade points</h4>
								<div class="sp-fields">{upgrades.map(fieldInput)}</div>
							</div>
						)}
						{(!readOnly || entry.customTree) && (
							<div class="pf-wide">
								<CustomTreeBuilder
									entry={entry}
									disabled={readOnly}
									onChange={(tree) =>
										setEntry((e) => {
											const prevTree = e.customTree;
											e.customTree = tree;
											if (tree && Array.isArray(tree.nodes)) syncTreeToSkills(tree, prevTree, e, props.isEvolution);
											lockPastStart(e, def.startingMoves?.(e.fields), props.isEvolution);
										})
									}
								/>
							</div>
						)}
					</Fragment>
				);
			}
		}
	};

	return (
		<>
			<PinBoxes notes={(props.pins ?? []).filter((n) => n.step === 'systems' && n.target === `card:${entry.key}`)} sheet={sheet} />
			<AbilitySource
				entry={entry}
				abilities={props.familyAbilities && props.familyAbilities.filter((p) => p.details.ability && abilitySystem(p.details.ability) === entry.system)}
				familyName={props.familyName}
				disabled={readOnly}
				onOwn={() =>
					setEntry((e) => {
						delete e.familyLink;
						e.fields = defaults(def.fields);
						e.skills = [];
					})
				}
				onLink={(perk) =>
					setEntry((e) => {
						const proof = e.familyLink?.proof ?? '';
						if (perk.id && perk.details.ability) {
							const mine = memberKeys(def, perk.details.ability);
							const family = Object.entries(copy(perk.details.ability.fields)).filter(([k]) => !mine.includes(k));
							e.fields = { ...e.fields, ...Object.fromEntries(family) };
							if (familyScope(def, perk.details.ability).skills) e.skills = copy(perk.details.ability.skills);
						}
						e.familyLink = { perkId: perk.id, familyId: perk.family_id, title: perk.title, proof };
					})
				}
				onProof={(v) => setEntry((e) => void (e.familyLink && (e.familyLink.proof = v)))}
			/>
			{traitEffects.length > 0 && (
				<div class="tr-effects">
					<span class="tr-effects-head">From your traits</span>
					<ul>
						{traitEffects.map((t) => (
							<li key={t.trait + t.effect}>
								<strong>{t.trait}</strong>
								<span>{t.effect}</span>
							</li>
						))}
					</ul>
				</div>
			)}
			<div class="df-post-tabs" role="tablist">
				{tabs.map((t) => (
					<button
						type="button"
						role="tab"
						key={t.id}
						aria-selected={t === current}
						class={`df-tab-btn${t === current ? ' active' : ''}${lockReason(t) ? ' locked' : ''}`}
						onClick={() => props.setTab(t.id)}
					>
						{lockReason(t) && <LockIcon />}
						<span class="df-tab-label">{labelOf(t)}</span>
						{t.blocks.some((b) => b.kind === 'skills') && entry.skills.length > 0 && <span class="df-tab-badge">{entry.skills.length}</span>}
						{t.id === 'extras' && picked.length > 0 && <span class="df-tab-badge">{picked.length}</span>}
						{t.blocks.some((b) => b.kind === 'cyberware') && piecesOf(f).length > 0 && <span class="df-tab-badge">{piecesOf(f).length}</span>}
					</button>
				))}
			</div>
			<div class="df-post-section" role="tabpanel">
				{locked && current.lock === 'approval' ? (
					// Browse-only until approved: the tab shows its own lock note.
					current.blocks.map(block)
				) : locked ? (
					<>
						<div class="sp-locked pf-wide">
							<LockIcon />
							<strong>Locked</strong>
							<p>{locked}</p>
						</div>
						{current.potential && potentialOf(current.potential) && <PotentialInfo {...potentialOf(current.potential)!} fields={f} />}
					</>
				) : (
					current.blocks.map(block)
				)}
			</div>
		</>
	);
}

/** A potential's requirements (with the character's progress) and what it gives. */
function PotentialInfo({ p, state, fields }: { p: PotentialDef; state: PotentialState; fields: Fields }) {
	const has = p.reached(fields);
	// Once reached, a one-off potential's requirements are done; a repeating one shows them for the next.
	const showReqs = !has || p.count !== undefined;
	return (
		<div class="sp-potential pf-wide">
			<p class="sp-pot-about">{p.about}</p>
			<div class="sp-pot-cols">
				{showReqs && (
					<section>
						<h5 class="sp-pot-head">{has ? 'For the next one' : 'Requirements'}</h5>
						<ul class="sp-reqs">
							{state.requirements.map((r) => (
								<li key={r.label} class={`sp-req ${r.status}`}>
									<span class="sp-req-mark" aria-hidden="true">
										{r.status === 'met' ? (
											'✓'
										) : r.status === 'staff' ? (
											<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
												<path d="M8 1.75 2.75 3.9v3.6c0 3.1 2.2 5.6 5.25 6.75 3.05-1.15 5.25-3.65 5.25-6.75V3.9L8 1.75Z" />
												<path d="m5.6 8 1.7 1.7 3.1-3.3" />
											</svg>
										) : (
											''
										)}
									</span>
									<span class="sp-req-body">
										<span>
											{r.label}
											{r.status === 'staff' && <span class="sp-req-staff">Staff check</span>}
										</span>
										{r.detail && r.status !== 'met' && <span class="sp-req-note">{r.detail}</span>}
										{r.progress && (
											<span class="sp-req-bar" role="img" aria-label={`${r.progress[0]} of ${r.progress[1]}`}>
												<span style={{ width: `${Math.min(100, (r.progress[0] / r.progress[1]) * 100)}%` }} />
												<em>
													{r.progress[0]} / {r.progress[1]}
												</em>
											</span>
										)}
									</span>
								</li>
							))}
						</ul>
					</section>
				)}
				<section>
					<h5 class="sp-pot-head">{p.perksLabel ?? (has ? 'What it gives you' : 'What you get')}</h5>
					<ul class="sp-perks">
						{p.perks(fields).map((x) => (
							<li key={x}>{x}</li>
						))}
					</ul>
				</section>
			</div>
		</div>
	);
}

/** A small key: something staff have to permit. */
function KeyIcon() {
	return (
		<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
			<circle cx="5.5" cy="10.5" r="3" />
			<path d="m7.6 8.4 6-6M11.5 4.5l1.5 1.5M10 6l1.2 1.2" />
		</svg>
	);
}

function LockIcon() {
	return (
		<svg class="sp-lock-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
			<path fill="currentColor" d="M8 1a3.5 3.5 0 0 0-3.5 3.5V7H4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-.5V4.5A3.5 3.5 0 0 0 8 1Zm-2 6V4.5a2 2 0 1 1 4 0V7H6Z" />
		</svg>
	);
}

export const SYSTEM_CANONICAL_NAMES: Record<string, string> = {
	'quirk': 'My Hero Academia',
	'jujutsu-kaisen': 'Jujutsu Kaisen',
	'fire-force': 'Fire Force',
	'abilities': 'Abilities',
	'jojo': "JoJo's Bizarre Adventure",
	'infamous': 'inFAMOUS',
	'tokyo-ghoul': 'Tokyo Ghoul',
	'chainsaw-man': 'Chainsaw Man',
	'cyberpunk': 'Cyberpunk 2077',
};

export function getSystemDisplayName(systemId: string, fallback?: string): string {
	return SYSTEM_CANONICAL_NAMES[systemId] ?? fallback ?? systemId;
}

function getAbilityTitle(entry: SystemEntry, defaultLabel: string, canonTitle?: string): string {
	const f = entry.fields;
	if (entry.familyLink?.title) return entry.familyLink.title;
	if (canonTitle) return canonTitle;
	for (const key of ['name', 'ctName', 'standName']) {
		const v = f[key];
		if (typeof v === 'string' && v.trim()) return v.trim();
	}
	return getSystemDisplayName(entry.system, defaultLabel);
}

function extractTags(def: NonNullable<ReturnType<typeof systemById.get>>, entry: SystemEntry): string[] {
	const tags: string[] = [];
	const f = entry.fields;
	if (Array.isArray(f.classes)) {
		for (const c of f.classes) tags.push(String(c));
	}
	if (typeof f.type === 'string' && f.type.trim() && !['abilities'].includes(entry.system)) {
		const label = def.fields.find((x) => x.key === 'type')?.options?.find((o) => o.value === f.type)?.label;
		tags.push(label ?? f.type);
	}
	if (typeof f.power === 'string' && f.power !== 'No Power') {
		tags.push(f.power);
	}
	if (typeof f.range === 'string') {
		tags.push(`${f.range} Range`);
	}
	if (typeof f.ceClass === 'string' && f.ceClass.trim()) {
		tags.push(`${f.ceClass} CE`);
	}
	if (entry.skills.length > 0) {
		tags.push(`${entry.skills.length} ${entry.skills.length === 1 ? 'Move' : 'Moves'}`);
	}
	if (entry.customTree) {
		tags.push('Custom Tree');
	}
	return tags;
}

/** The power systems home: difficulty and a one-line summary from each system's Index overview, and its colour. */
const HOME: Record<string, { difficulty: string; rank: number; summary: string; bestFor?: string; color: string }> = {
	quirk: { difficulty: 'Easy', rank: 1, summary: 'Quick to make and easy to evolve, but extremely specialized.', bestFor: 'your first system', color: '#3fbf6f' },
	abilities: { difficulty: 'Easy', rank: 1, summary: 'Endless possibilities and a high power ceiling. Harder to evolve than Quirks.', color: '#a77bff' },
	cyberpunk: { difficulty: 'Moderate', rank: 2, summary: 'Cyberware pushes your body far beyond its limits. Easy to understand and use.', bestFor: 'powerless builds', color: '#f2e04a' },
	'chainsaw-man': { difficulty: 'Moderate', rank: 2, summary: 'Built around player cooperation and mostly player driven.', color: '#e8553a' },
	'fire-force': { difficulty: 'Hard', rank: 3, summary: 'The meta of fire powers. Every Pyrokinetic follows a theme and sticks to it.', color: '#ff7a1f' },
	jojo: { difficulty: 'Difficult', rank: 3, summary: 'Hamon, Stands, Vampirism and Spin. Doesn’t rely on Potential.', color: '#e0b43a' },
	'tokyo-ghoul': { difficulty: 'Difficult', rank: 3, summary: 'For Humans and Ghouls. Being a Ghoul can mean killing other characters to survive.', color: '#c4213f' },
	infamous: { difficulty: 'Very Difficult', rank: 4, summary: 'Extremely powerful if used right, with arguably the hardest evolution path.', color: '#3d9bff' },
	'jujutsu-kaisen': { difficulty: 'Extremely Hard', rank: 5, summary: 'The most versatile and complex system, and one of the strongest. Relies heavily on RNG.', color: '#7b5cff' },
};

export function SystemsSection(props: Props) {
	const { sheet, update, readOnly } = props;
	const setEntry = (key: string, fn: (e: SystemEntry) => void) =>
		update((s) => {
			const e = s.systems.find((x) => x.key === key);
			if (e) fn(e);
		});

	const heavenly = heavenlyOf(sheet);

	// The open system card (null shows the power systems home).
	const [activeKey, setActiveKey] = useState<string | null>(null);
	const [postTab, setPostTab] = useState<string>('main');
	const open = (key: string | null) => {
		setActiveKey(key);
		setPostTab('main');
	};

	const limitedChoiceFull = (entry: SystemEntry) => {
		if (props.adminCharacter) return false;
		const def = systemById.get(entry.system);
		const others = sheet.systems.filter((e) => e !== entry && e.system === entry.system && countsTowardLimit(def, e.fields)).length;
		return others >= systemLimit(sheet, entry.system, props.comboSystemLimits);
	};

	const currentEntry = sheet.systems.find((e) => e.key === activeKey) ?? null;
	const currentDef = currentEntry ? systemById.get(currentEntry.system) : null;
	const titleOf = (e: SystemEntry) => getAbilityTitle(e, getSystemDisplayName(e.system), canonClaimFor(sheet, e, props.requestedClaims, props.claimBoard)?.name);
	const priorityKey = sheet.systems.length === 1 ? sheet.systems[0].key : sheet.prioritySystem;
	const remove = (key: string) => {
		update((s) => {
			s.systems = s.systems.filter((x) => x.key !== key);
			if (s.prioritySystem === key || s.systems.length === 1) s.prioritySystem = s.systems[0]?.key ?? '';
		});
		if (activeKey === key) open(null);
	};
	const addSystem = (id: string) => {
		const def = systemById.get(id)!;
		const key = newKey();
		update((s) => {
			s.systems.push({ key, system: id, fields: defaults(def.fields), description: '', skills: [], rollProofs: {} });
			if (s.systems.length === 1) s.prioritySystem = key;
		});
		open(key);
	};

	/** Why a system can't be added right now, or null. */
	const cantAdd = (id: string): string | null => {
		const sys = systemById.get(id)!;
		if (props.adminCharacter) return null;
		if (heavenly && !HEAVENLY_SYSTEMS.includes(id)) return 'Not with a Heavenly Restriction';
		const limit = systemLimit(sheet, id, props.comboSystemLimits);
		const have = sheet.systems.filter((e) => e.system === id).length;
		if (!sys.limitedChoice && have >= limit) return limit === 1 ? 'You already have one' : `You have the most (${limit})`;
		return null;
	};

	/** A card's status from the rules check. */
	const statusOf = (key: string): { tone: 'ok' | 'warn' | 'bad'; text: string } => {
		const mine = (props.issues ?? []).filter((i) => i.card === key);
		const errors = mine.filter((i) => i.level === 'error').length;
		const checks = mine.filter((i) => i.level === 'warning').length;
		const asks = mine.filter((i) => i.level === 'permission').length;
		if (errors) return { tone: 'bad', text: `${errors} thing${errors === 1 ? '' : 's'} to fill in` };
		if (checks) return { tone: 'warn', text: `${checks} thing${checks === 1 ? '' : 's'} to check` };
		if (asks) return { tone: 'warn', text: 'Ready · needs staff permission' };
		return { tone: 'ok', text: 'Ready' };
	};

	const tiles = [...systems].sort((a, b) => (HOME[a.id]?.rank ?? 9) - (HOME[b.id]?.rank ?? 9) || Number(Boolean(HOME[b.id]?.bestFor)) - Number(Boolean(HOME[a.id]?.bestFor)));

	if (currentEntry && currentDef) {
		const sysName = getSystemDisplayName(currentEntry.system);
		const budget = !props.isEvolution && !currentEntry.familyLink ? systemBudget(sheet, currentEntry) : null;
		// A new character's own card can ask to start past the usual stats.
		const canAsk = !readOnly && !props.isEvolution && !currentEntry.familyLink;
		return (
			<Section id="systems" title="Power systems">
				<div class="df-forum pf-wide">
					<div class="df-post">
						<div class="df-post-nav">
							<div class="df-post-title-row">
								<button type="button" class="df-back-btn" onClick={() => open(null)}>
									← All systems
								</button>
								<div class="df-post-heading">
									<h3 class="df-post-title">{titleOf(currentEntry)}</h3>
									<span class="df-post-system">{sysName} System</span>
								</div>
								{currentEntry.familyLink && <span class="df-tag family">Family ability</span>}
								{priorityKey === currentEntry.key ? (
									<span class="df-tag priority">Priority</span>
								) : (
									!readOnly && (
										<button type="button" class="pf-button subtle" onClick={() => update((s) => void (s.prioritySystem = currentEntry.key))}>
											Make priority
										</button>
									)
								)}
							</div>
							<div class="sh-post-actions">
								{budget && budget.total > 0 && (
									<span class={`df-tag budget${budget.spent > budget.total ? ' bad' : ''}`}>
										{budget.label}: {budget.spent} / {budget.total}
									</span>
								)}
								{canAsk && (
									<button
										type="button"
										class={`pf-button so-toggle${currentEntry.statOverride ? ' on' : ''}`}
										aria-pressed={Boolean(currentEntry.statOverride)}
										onClick={() => setEntry(currentEntry.key, (e) => (e.statOverride ? dropStatOverride(sheet, e, props.staffOverrides) : void (e.statOverride = { reason: '' })))}
									>
										{currentEntry.statOverride ? 'Cancel override' : 'Request override'}
									</button>
								)}
								{!readOnly && <RemoveButton label="Remove" confirmLabel={`Remove ${titleOf(currentEntry)}?`} onConfirm={() => remove(currentEntry.key)} />}
							</div>
						</div>
						{currentEntry.statOverride && !props.isEvolution && !currentEntry.familyLink && (
							<StatOverride
								request={currentEntry.statOverride}
								freeText={!currentDef.budget && !currentDef.fields.some((x) => x.startsAt !== undefined)}
								disabled={readOnly}
								onChange={(next) => setEntry(currentEntry.key, (e) => void (e.statOverride = next))}
							/>
						)}
						<SystemPanel {...props} entry={currentEntry} def={currentDef} tab={postTab} setTab={setPostTab} limitedChoiceFull={limitedChoiceFull} />
					</div>
				</div>
			</Section>
		);
	}

	const priority = sheet.systems.find((e) => e.key === priorityKey);
	return (
		<Section id="systems" title="Power systems" intro="Pick what powers your character. You can have more than one.">
			<div class="sh pf-wide">
				{sheet.systems.length > 0 && (
					<div class="sh-chips">
						<span class="sh-chip">
							{sheet.systems.length} system{sheet.systems.length === 1 ? '' : 's'}
						</span>
						{priority && <span class="sh-chip sh-chip-priority">Priority: {titleOf(priority)}</span>}
					</div>
				)}

				{sheet.systems.length > 0 && (
					<section class="sh-block" aria-label="Your systems">
						<h3 class="sh-heading">Your systems</h3>
						<div class="sh-cards">
							{sheet.systems.map((entry) => {
								const def = systemById.get(entry.system);
								if (!def) return null;
								const canon = canonClaimFor(sheet, entry, props.requestedClaims, props.claimBoard);
								const theme = canon ? canonTheme(canon.name, canon.universe) : null;
								const facts = [...(canon ? ['Canon'] : []), ...extractTags(def, entry).filter((t) => !/\bMoves?\b|Custom Tree/.test(t))].slice(0, 3);
								const usable = entry.skills.filter((s) => !s.locked).length;
								const status = statusOf(entry.key);
								const title = titleOf(entry);
								return (
									<article
										key={entry.key}
										class={`sh-card${theme ? ' sh-canon' : ''}`}
										style={{ '--sh-color': HOME[entry.system]?.color ?? 'var(--sl-color-text-accent)', ...(theme ? { '--cq-a': theme.a } : {}) }}
									>
										<button type="button" class="sh-card-open" onClick={() => open(entry.key)} aria-label={`Open ${title}`} />
										<div class="sh-card-top">
											<div class="sh-card-names">
												<h4 class="sh-card-title">{title}</h4>
												<span class="sh-card-system">{getSystemDisplayName(entry.system, def.label)} System</span>
											</div>
											{priorityKey === entry.key && <span class="df-tag priority">Priority</span>}
										</div>
										{facts.length > 0 && <p class="sh-facts">{facts.join(' · ')}</p>}
										<p class="sh-skills">
											{usable} skill{usable === 1 ? '' : 's'}
											{entry.customTree ? ' · Skill Tree' : ''}
											{entry.familyLink ? ' · Family ability' : ''}
										</p>
										<div class="sh-card-foot">
											<span class={`sh-status ${status.tone}`}>{status.text}</span>
											{!readOnly && (
												<details class="sh-menu">
													<summary aria-label={`More for ${title}`}>⋯</summary>
													<div class="sh-menu-list">
														{priorityKey !== entry.key && (
															<button type="button" class="pf-button subtle" onClick={() => update((s) => void (s.prioritySystem = entry.key))}>
																Make priority
															</button>
														)}
														<RemoveButton label="Remove" confirmLabel={`Remove ${title}?`} onConfirm={() => remove(entry.key)} />
													</div>
												</details>
											)}
										</div>
									</article>
								);
							})}
						</div>
					</section>
				)}

				{/* Systems staff grant to one character (e.g. Speed Force) will be listed here, from the Admin Panel. */}

				{!readOnly && (
					<section class="sh-block" aria-label="Add a system">
						<h3 class="sh-heading">{sheet.systems.length ? 'Add a system' : 'Start by picking a power system'}</h3>
						{sheet.systems.length === 0 && <p class="pf-help sh-lead">Not sure? My Hero Academia is the easiest place to start. You can add more later.</p>}
						<div class="sh-tiles">
							{tiles.map((sys) => {
								const info = HOME[sys.id];
								const why = cantAdd(sys.id);
								return (
									<button
										type="button"
										key={sys.id}
										class="sh-tile"
										style={{ '--sh-color': info?.color ?? 'var(--sl-color-text-accent)' }}
										disabled={Boolean(why)}
										onClick={() => addSystem(sys.id)}
									>
										<span class="sh-tile-name">{getSystemDisplayName(sys.id, sys.label)}</span>
										{info && <span class={`sh-diff d${info.rank}`}>{info.difficulty}</span>}
										{info && <span class="sh-tile-line">{info.summary}</span>}
										{info?.bestFor && !why && <span class="sh-tile-best">Best for: {info.bestFor}</span>}
										{why && <span class="sh-tile-why">{why}</span>}
									</button>
								);
							})}
						</div>
					</section>
				)}
				{readOnly && sheet.systems.length === 0 && <p class="pf-help">No power systems.</p>}
			</div>
		</Section>
	);
}
