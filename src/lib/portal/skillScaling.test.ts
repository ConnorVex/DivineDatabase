import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingTraits, normalizeScaling, scalingLabels, scalingTags, upgradedTotals } from './skillScaling.ts';
import type { Skill } from './sheet.ts';

const jjk = scalingLabels('jujutsu-kaisen');
const skill = (scaling: object, extra: Partial<Skill> = {}): Skill => ({ name: 'Cut', type: 'standard', effect: '', mastery: '', scaling: normalizeScaling(scaling), ...extra });

test('fixed cost and power with upgrades', () => {
	const s = normalizeScaling({ cost: 'fixed', costAmount: 60, power: 'fixed', powerAmount: 30, upgrades: [{ kind: 'power', amount: 10 }, { kind: 'cost', amount: 15 }, { kind: 'cost', amount: 200 }, { kind: 'other', note: 'x' }] });
	assert.deepEqual(upgradedTotals(s), { power: 40, cost: 0 });
	const tags = scalingTags(skill(s), jjk).map((t) => t.text);
	assert.deepEqual(tags, ['CE Cost: 60 CEP (down to 0)', 'ET Power: 30 (up to 40)', 'Starting Extension']);
});

test('dependent, infinite, locked, effects and trait', () => {
	const tags = scalingTags(skill({ cost: 'dependent', power: 'infinite', access: 'locked', effects: ['Ignores Armour'], requiredTrait: 'Test Trait' }), jjk).map((t) => t.text);
	assert.deepEqual(tags, ['CE Cost: Dependent', 'ET Power: Infinite', 'Locked Extension', 'Ignores Armour', 'Required Trait: Test Trait']);
	assert.deepEqual(scalingTags({ scaling: undefined }, jjk), []);
});

test('generic labels for other series', () => {
	assert.equal(scalingTags(skill({ cost: 'none' }), scalingLabels('quirk'))[0].text, 'Cost: None');
});

test('missing traits skip locked skills', () => {
	const sk = [skill({ requiredTrait: 'Test Trait' }), skill({ requiredTrait: 'Test Trait', access: 'locked' }), skill({ requiredTrait: 'Test Trait' }, { locked: true })];
	assert.equal(missingTraits(sk, []).length, 1);
	assert.equal(missingTraits(sk, ['Test Trait']).length, 0);
});
