import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metamorphosisCap, potentialState, potentialsFor } from './potentials.ts';

const [awakening, variant] = potentialsFor('quirk');
const entry = (fields: Record<string, string | number>) => ({ key: 'q', fields });
const ctx = { potential: 'great', traits: [] as string[] };

test('a potential is locked for new characters, and opens after approval once the sheet meets its requirements', () => {
	assert.equal(potentialState(awakening, entry({ upgradePoints: 95 }), ctx).open, false);
	assert.equal(potentialState(awakening, entry({ upgradePoints: 40 }), { ...ctx, isEvolution: true }).open, false);
	const ready = potentialState(awakening, entry({ upgradePoints: 95 }), { ...ctx, isEvolution: true });
	assert.equal(ready.open, true);
	assert.deepEqual(ready.requirements[0].progress, [95, 90]);
	assert.equal(potentialState(awakening, entry({ awakenings: 1 }), { ...ctx, isEvolution: true }).open, true, 'already has one');
	assert.equal(potentialState(awakening, entry({}), { ...ctx, staffOverrides: { 'card:q.awakenings': {} } }).open, true, 'staff');
});

test('Instability needs Great Potential and maxed Quirk Power (Great with Quirk Prodigy)', () => {
	const reqs = (fields: Record<string, string | number>, c = ctx) => variant.requirements(fields, c).map((r) => r.status);
	assert.deepEqual(reqs({ power: 'Average', upgradePoints: 50 }), ['met', 'met', 'met', 'staff', 'staff']);
	assert.deepEqual(reqs({ power: 'Average', upgradePoints: 50 }, { potential: 'great', traits: ['Quirk Prodigy'] }).slice(0, 2), ['met', 'unmet']);
	assert.deepEqual(reqs({ power: 'Average', upgradePoints: 10 }, { potential: 'average', traits: [] }).slice(0, 3), ['unmet', 'met', 'unmet']);
	assert.ok(variant.perks({ variant: 'Maximum' }).some((p) => /1 capability/.test(p)));
});

test('Quirk rolls: 3 failed Instability rolls block it; an unstable roll waits for one Spontaneous Evolution roll', async () => {
	const { quirkRollStage, evolutionResult } = await import('./evolutionRolls.ts');
	const r = (id: number, kind: 'quirk_instability' | 'quirk_evolution', roll: number) => ({ id, card_key: 'q', kind, sides: 0, roll, result: evolutionResult(kind, roll), created_at: '' });
	assert.deepEqual(quirkRollStage([]), { stage: 'instability', fails: 0 });
	assert.equal(quirkRollStage([r(1, 'quirk_instability', 100), r(2, 'quirk_instability', 499), r(3, 'quirk_instability', 3)]).stage, 'failed');
	assert.equal(quirkRollStage([r(1, 'quirk_instability', 100), r(2, 'quirk_instability', 500)]).stage, 'unstable');
	assert.deepEqual(quirkRollStage([r(1, 'quirk_instability', 700), r(2, 'quirk_evolution', 900)]), { stage: 'instability', fails: 0 });
	assert.deepEqual([1000, 1001, 5000, 5001, 7999, 8000, 9949, 9950].map((n) => evolutionResult('quirk_evolution', n)), ['nothing', 'awakening', 'awakening', 'plus', 'plus', 'maximum', 'maximum', 'infinite']);
});

test('Abilities: Metamorphoses are capped by Potential and cost 50 AUP more each time', async () => {
	const { metamorphosisCap } = await import('./potentials.ts');
	const [meta, overclock, underclock] = potentialsFor('abilities');
	assert.deepEqual(['low', 'average', 'insane', 'colossal', 'divine'].map(metamorphosisCap), [1, 2, 4, 5, 10]);
	const reqs = meta.requirements({ metamorphoses: 1, upgradePoints: 100 }, { potential: 'average', traits: [] });
	assert.deepEqual(reqs.map((r) => r.status), ['met', 'met', 'staff']);
	assert.match(reqs[1].label, /100 AUP/);
	assert.match(reqs[2].label, /5 RPs/);
	assert.equal(meta.requirements({ metamorphoses: 2 }, { potential: 'average', traits: [] })[0].status, 'unmet', 'Average allows 2');
	assert.equal(overclock.requirements({ upgradePoints: 99 }, { potential: '', traits: [] })[0].status, 'unmet');
	const second = (n: number) => underclock.requirements({ upgradePoints: 150 }, { potential: '', traits: [], systemCounts: { abilities: n } })[1].status;
	assert.deepEqual([second(1), second(2)], ['unmet', 'met'], 'Underclocking needs another ability');
});

test('Overclock Instability: 1–5 nothing, 6–9 exit, 10 lost', async () => {
	const { evolutionResult, overclockGain } = await import('./evolutionRolls.ts');
	assert.deepEqual([1, 5, 6, 9, 10].map((n) => evolutionResult('overclock_instability', n)), ['steady', 'steady', 'exit', 'exit', 'lost']);
	assert.deepEqual([0, 1, 2].map(overclockGain), [10, 8, 6]);
});

test('Unparalleled Potential sits between Apex and Divine and is never rolled', async () => {
	const rules = (await import('../../data/portal/rules.json', { with: { type: 'json' } })).default;
	const ids = rules.potentials.map((p) => p.id);
	assert.equal(ids.indexOf('unparalleled'), ids.indexOf('apex') + 1);
	assert.equal(ids.indexOf('divine'), ids.indexOf('unparalleled') + 1);
	const u = rules.potentials.find((p) => p.id === 'unparalleled')!;
	assert.deepEqual([u.maxPhase, u.maxTier, u.rolled], [3, 20, false]);
	assert.equal(metamorphosisCap('unparalleled'), 10);
});
