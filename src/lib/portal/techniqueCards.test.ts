import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTechniqueCard, jjkMainKey, techniqueFields } from './systems.ts';

const own = (key: string) => ({ key, system: 'jujutsu-kaisen' });
const power = (key: string) => ({ key, system: 'jujutsu-kaisen', powerLink: {} });

test('the main card is the first own one, else the first', () => {
	assert.equal(jjkMainKey([power('p'), own('a'), own('b')]), 'a');
	assert.equal(jjkMainKey([power('p'), power('q')]), 'p');
	assert.equal(jjkMainKey([{ key: 'x', system: 'quirk' }]), undefined);
});

test('every other JJK card is a technique card', () => {
	const sys = [power('p'), own('a'), own('b'), { key: 'q', system: 'quirk' }];
	assert.deepEqual(sys.map((e) => isTechniqueCard(sys, e)), [true, false, true, false]);
});

test('a technique card always shows its technique', () => {
	assert.deepEqual(techniqueFields({ start: 'Cursed Energy Utilization only', heavenlyRestriction: 'Physical', ctName: 'X' }), { start: 'Cursed Technique', heavenlyRestriction: 'None', ctName: 'X' });
});
