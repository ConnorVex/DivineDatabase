import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lockPastStart } from './skillLocks.ts';
import type { Skill, SystemEntry } from './sheet.ts';

const skill = (name: string, type: Skill['type'], treeNodeId?: string): Skill => ({ name, type, effect: '', mastery: '', treeNodeId });
const card = (skills: Skill[]): SystemEntry =>
	({
		key: 'a',
		system: 'quirk',
		fields: {},
		description: '',
		rollProofs: {},
		skills,
		customTree: {
			name: 'Tree',
			currency: 'QUP',
			custom: { name: '', code: '', gain: 0, convertFrom: '', convertFromAmount: 1, convertToAmount: 1 },
			nodes: [{ id: 'root', label: 'Start', description: '', cost: 0, requires: [], start: true }, ...skills.filter((s) => s.treeNodeId).map((s) => ({ id: s.treeNodeId!, label: s.name, description: '', cost: 5, requires: ['root'], start: false }))],
		},
	}) as SystemEntry;

const quirk = { standard: 3, ultimate: 2 };

test('tree skills past the starting skills are locked; the starting ones are known on the tree', () => {
	const e = card([skill('A', 'standard', 'a'), skill('B', 'standard', 'b'), skill('C', 'standard', 'c'), skill('D', 'standard', 'd'), skill('U', 'ultimate', 'u')]);
	lockPastStart(e, quirk, false);
	assert.deepEqual(e.skills.map((s) => Boolean(s.locked)), [false, false, false, true, false]);
	assert.deepEqual(e.customTree!.nodes.filter((n) => n.known).map((n) => n.id), ['a', 'b', 'c', 'u']);
	// Removing a starting skill lets the next one in.
	e.skills.splice(0, 1);
	lockPastStart(e, quirk, false);
	assert.ok(!e.skills.find((s) => s.name === 'D')!.locked);
});

test('after approval locks are left for the tree to open', () => {
	const e = card([skill('A', 'standard', 'a'), { ...skill('D', 'standard', 'd'), locked: true }]);
	lockPastStart(e, quirk, true);
	assert.equal(e.skills[1].locked, true);
});

test('a Cursed Technique still gets one Maximum Technique from the tree', () => {
	const e = card([skill('M1', 'ultimate', 'm1'), skill('M2', 'ultimate', 'm2')]);
	lockPastStart(e, { standard: 2, ultimateCap: 1 }, false);
	assert.deepEqual(e.skills.map((s) => Boolean(s.locked)), [false, true]);
});

test('Cursed Energy Utilization only starts with a single skill and no Maximum Technique', async () => {
	const { systemById } = await import('./systems.ts');
	const limits = systemById.get('jujutsu-kaisen')!.startingMoves!({ start: 'Cursed Energy Utilization only' });
	const e = card([skill('A', 'standard', 'a'), skill('B', 'standard', 'b'), skill('U', 'ultimate', 'u')]);
	lockPastStart(e, limits, false);
	assert.deepEqual(e.skills.map((s) => Boolean(s.locked)), [false, true, true]);
});
