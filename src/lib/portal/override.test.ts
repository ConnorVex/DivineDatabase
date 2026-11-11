import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeOverride } from './override.ts';
import { applyIgnored, issueKey, type Issue } from './rules.ts';

test('override merge keeps what the player changed meanwhile', () => {
	const base = { name: 'A', stats: { strength: 'C', speed: 'C' }, systems: [{ key: 'q', fields: { power: 'Puny', range: 'Close' } }] };
	const mine = { name: 'A', stats: { strength: 'S', speed: 'C' }, systems: [{ key: 'q', fields: { power: 'Strong', range: 'Close' } }, { key: 'n', fields: {} }] };
	const theirs = { name: 'B', stats: { strength: 'C', speed: 'B' }, systems: [{ key: 'q', fields: { power: 'Puny', range: 'Far' } }, { key: 'p', fields: {} }] };
	assert.deepEqual(mergeOverride(base, mine, theirs), {
		name: 'B',
		stats: { strength: 'S', speed: 'B' },
		systems: [{ key: 'q', fields: { power: 'Strong', range: 'Far' } }, { key: 'n', fields: {} }, { key: 'p', fields: {} }],
	});
});

test('override merge: staff win clashes, removed cards stay removed', () => {
	const base = { s: 'C', systems: [{ key: 'a', v: 1 }, { key: 'b', v: 1 }] };
	const mine = { s: 'S', systems: [{ key: 'a', v: 1 }] };
	const theirs = { s: 'B', systems: [{ key: 'a', v: 2 }, { key: 'b', v: 1 }] };
	assert.deepEqual(mergeOverride(base, mine, theirs), { s: 'S', systems: [{ key: 'a', v: 2 }] });
	assert.deepEqual(mergeOverride(base, base, theirs), theirs);
});

test('ignored checks match with the numbers left out', () => {
	const a: Issue = { level: 'error', section: 'Stats', message: 'You spent 45 of 40 PTP.' };
	const b: Issue = { level: 'error', section: 'Stats', message: 'You spent 50 of 40 PTP.' };
	const c: Issue = { level: 'warning', section: 'Traits', message: 'Pick 2 traits.' };
	assert.equal(issueKey(a), issueKey(b));
	const out = applyIgnored([b, c], [issueKey(a)]);
	assert.deepEqual(out.map((i) => i.level), ['ignored', 'warning']);
});
