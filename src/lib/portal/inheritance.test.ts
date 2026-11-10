// Run with: node --test src/lib/portal/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BoardPerk } from '../families/api.ts';
import { applyInheritance, inheritanceEffects, inheritanceIssues, inheritedOptions, inheritedPerks, type InheritanceRoll } from './inheritance.ts';
import { emptySheet, optionKey, type Sheet } from './sheet.ts';

let n = 0;
const perk = (p: Partial<BoardPerk>): BoardPerk => ({
	id: `p${++n}`,
	family_id: 'fam',
	hidden: false,
	title: 'Perk',
	description: '',
	details: {},
	unlocked: true,
	kind: 'other',
	access: 'automatic',
	...p,
});
const roll = (perkId: string, status: InheritanceRoll['status'], option = ''): InheritanceRoll => ({
	id: `r-${perkId}-${option}`,
	family_id: 'fam',
	character_id: 'c',
	player_id: 'u',
	character_name: 'Kid',
	perk_id: perkId,
	option,
	label: '',
	status,
	proof: '',
	note: '',
	created_at: '',
	decided_at: null,
});

const guaranteedTrait = perk({ kind: 'trait', title: 'Iron Lungs', details: { trait: 'Iron Lungs', customTrait: { category: 'physical', effect: 'buff' } } });
const pickTrait = perk({ kind: 'trait', access: 'choice', title: 'Second Heart', details: { trait: 'Second Heart', customTrait: { category: 'physical', effect: 'buff' } } });
const rolledStyle = perk({ kind: 'fighting_style', access: 'rolled', title: 'River Fist', details: { style: { styleClass: 'Flow', passive: '', activation: '' } } });
const earned = perk({ kind: 'trait', access: 'earned', title: 'Late Bloom', details: { trait: 'Late Bloom' } });
const stats = perk({ kind: 'starting_stats', details: { stats: { strength: '10F', speed: '', defense: '', stamina: '', intelligence: 'Genius', extraPtp: 8 } } });
const slots = perk({ kind: 'trait_slots', details: { traitRules: { extraSlots: 3, regularSlots: false, anyTrait: false, countsForCombos: false, potentials: ['high'] } } });
const hidden = perk({ kind: null, access: null, unlocked: false, hidden: true, details: null as never });
const other = perk({ family_id: 'other', kind: 'trait', title: 'Elsewhere', details: { trait: 'Elsewhere' } });
const all = [guaranteedTrait, pickTrait, rolledStyle, earned, stats, slots, hidden, other];

const inh = (patch = {}) => ({ familyId: 'fam', picks: [] as string[], options: [] as string[], potential: '', ...patch });
const sheetWith = (i = inh()): Sheet => ({ ...emptySheet(), inheritance: i });
const key = () => `k${++n}`;

test('a character inherits Guaranteed perks, the picks it took and the rolls it won', () => {
	const ids = (p: BoardPerk[]) => p.map((x) => x.title);
	assert.deepEqual(ids(inheritedPerks(all, inh(), [])), ['Iron Lungs', 'Perk', 'Perk']);
	const got = inheritedPerks(all, inh({ picks: [pickTrait.id] }), [roll(rolledStyle.id, 'won')]);
	assert.ok(got.some((p) => p.id === pickTrait.id));
	assert.ok(got.some((p) => p.id === rolledStyle.id));
	assert.ok(!got.some((p) => p.id === earned.id || p.id === other.id || p.id === hidden.id));
	assert.ok(!inheritedPerks(all, inh(), [roll(rolledStyle.id, 'pending')]).some((p) => p.id === rolledStyle.id));
});

test('the effects add trait slots and PTP and fix stats', () => {
	const e = inheritanceEffects(inheritedPerks(all, inh(), []));
	assert.equal(e.extraTraitSlots, 3);
	assert.equal(e.bonusPtp, 8);
	assert.deepEqual(e.stats, { strength: '10F', intelligence: 'Genius' });
	assert.equal(e.regularSlots, false);
	assert.deepEqual(e.potentials, ['high']);
	assert.ok(e.overrides['stats.strength']);
});

test('applying writes traits, styles and stats, and takes off what is no longer inherited', () => {
	const s = sheetWith(inh({ picks: [pickTrait.id], potential: 'high' }));
	const rolls = [roll(rolledStyle.id, 'won')];
	assert.equal(applyInheritance(s, all, inheritedPerks(all, s.inheritance!, rolls), key, () => ({})), true);
	assert.deepEqual(s.traits.map((t) => [t.name, t.perkId]), [
		['Iron Lungs', guaranteedTrait.id],
		['Second Heart', pickTrait.id],
	]);
	assert.deepEqual(s.combat.styles, [{ name: 'River Fist', rollProof: '' }]);
	assert.equal(s.stats.strength, '10F');
	assert.equal(s.stats.intelligence, 'Genius');
	assert.equal(s.potential.grade, 'high');
	assert.deepEqual(s.families, ['fam']);
	// Applying again changes nothing.
	assert.equal(applyInheritance(s, all, inheritedPerks(all, s.inheritance!, rolls), key, () => ({})), false);

	// Dropping the pick and losing the roll take them off.
	s.inheritance!.picks = [];
	applyInheritance(s, all, inheritedPerks(all, s.inheritance!, [roll(rolledStyle.id, 'lost')]), key, () => ({}));
	assert.deepEqual(s.traits.map((t) => t.name), ['Iron Lungs']);
	assert.deepEqual(s.combat.styles, []);
});

test('a family that turns off regular slots flags regular traits', () => {
	const s = sheetWith();
	s.traits = [{ name: 'Strong' }];
	const got = inheritedPerks(all, s.inheritance!, []);
	const issues = inheritanceIssues(s, got, [], 'Test Clan');
	assert.ok(issues.some((i) => i.level === 'error' && i.message.includes('remove Strong')));
});

test('System rules: required cards, fixed values, banned and rolled options', () => {
	const jjk = perk({
		kind: 'system_start',
		details: {
			systemRules: {
				system: 'jujutsu-kaisen',
				required: 'yes',
				unless: '',
				fixed: { ctPower: 'Below Grade 4' },
				options: [
					{ field: 'ctGrade', value: 'Special Grade', access: 'banned', custom: false, detail: '' },
					{ field: 'ceClass', value: 'Vast', access: 'rolled', custom: true, detail: '8K Cursed Energy' },
					{ field: 'ceClass', value: 'Steady', access: 'start', custom: true, detail: '' },
				],
				extraPoints: 0,
				pointsLabel: '',
				moveLimit: 'default',
			},
		},
	});
	const s = sheetWith(inh({ options: [optionKey(jjk.id, 'ceClass', 'Steady')] }));
	const got = inheritedPerks([jjk], s.inheritance!, []);
	assert.ok(inheritanceIssues(s, got, [], 'Clan').some((i) => i.message.includes('add a')));

	applyInheritance(s, [jjk], got, key, () => ({}));
	const card = s.systems.find((e) => e.system === 'jujutsu-kaisen')!;
	assert.equal(card.fields.ctPower, 'Below Grade 4');
	assert.deepEqual(inheritanceIssues(s, got, [], 'Clan').filter((i) => i.level === 'error'), []);

	card.fields.ctGrade = 'Special Grade';
	card.fields.ceClass = 'Vast';
	const errors = inheritanceIssues(s, got, [], 'Clan').filter((i) => i.level === 'error').map((i) => i.message);
	assert.equal(errors.length, 2);

	// Winning the roll makes Vast fine, and the reviewer sees what was won.
	const rolls = [roll(jjk.id, 'won', 'ceClass=Vast')];
	const options = inheritedOptions(got, s.inheritance!, rolls);
	assert.deepEqual(options.map((o) => o.option.value), ['Vast', 'Steady']);
	const issues = inheritanceIssues(s, got, options, 'Clan');
	assert.equal(issues.filter((i) => i.level === 'error').length, 1);
	assert.ok(issues.some((i) => i.level === 'permission' && i.message.includes('roll won') && i.message.includes('Vast')));
});
