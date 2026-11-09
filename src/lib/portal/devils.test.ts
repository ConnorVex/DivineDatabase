// Run with: node --test src/lib/portal/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { devilStats, fearSpent, regenCost } from './devils.ts';

test('Devil stats follow the class, path and upgrades', () => {
	assert.deepEqual(devilStats({ path: 'Devil', devilClass: 'Rational' }), { tank: 200, dap: 20, healing: 'Regenerate for 160 BP', upgradeable: true });
	assert.equal(devilStats({ path: 'Devil', devilClass: 'Mundane', tankUpgrades: 3 }).tank, 200);
	assert.equal(devilStats({ path: 'Devil', devilClass: 'Mundane', tankUpgrades: 6 }).tank, 250);
	assert.equal(devilStats({ path: 'Devil', devilClass: 'Mundane', tankUpgrades: 7 }).tank, 300, 'Max: the class max');
	assert.equal(devilStats({ path: 'Devil', devilClass: 'Primal', tankUpgrades: 7, tankBonus: 2 }).tank, 490, '+20 per upgrade past the max');
	assert.deepEqual(devilStats({ path: 'Fiend', devilClass: 'Irrational' }), { tank: 115, dap: 20, healing: 'Heals all injuries for 5.8 BP', upgradeable: false });
	assert.equal(devilStats({ path: 'Hybrid', devilClass: 'Mundane' }).tank, 350);
	assert.equal(devilStats({ path: 'Human with contracts' }).tank, null);
});

test('Fear Points spent and Regeneration cost', () => {
	assert.equal(fearSpent({ tankUpgrades: 7, tankBonus: 1, regenUpgrades: 2 }), 100 + 30 + 40);
	assert.equal(regenCost(0), 160);
	assert.equal(regenCost(5), 110);
	assert.equal(regenCost(6), 50);
});
