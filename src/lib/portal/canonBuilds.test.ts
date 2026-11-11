import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonGroups, cleanBuild, type CanonBuild } from './canonBuilds.ts';

const sk = (name: string) => ({ name, type: 'standard' as const, effect: '', mastery: '' });
const build: CanonBuild = {
	claimable_id: 'q',
	about: '',
	skills: [sk('Base 1'), sk('Base 2')],
	variants: { Plus: { about: '', skills: [sk('Plus 1')] }, Maximum: { about: 'More', skills: [sk('Max 1')] } },
	updated_at: '',
};

test('a Quirk with no variant gets the base, with variants locked', () => {
	const g = canonGroups(build, 'quirk', { variant: 'None' });
	assert.deepEqual(g.map((x) => [x.variant, x.reached, x.skills.length]), [['', true, 2], ['Plus', false, 1], ['Maximum', false, 1]]);
});

test('reaching a variant opens it and every one before it', () => {
	assert.deepEqual(canonGroups(build, 'quirk', { variant: 'Plus' }).map((x) => x.reached), [true, true, false]);
	assert.deepEqual(canonGroups(build, 'quirk', { variant: 'Infinite' }).map((x) => x.reached), [true, true, true]);
});

test('other series have no variants', () => {
	assert.deepEqual(canonGroups(build, 'jojo', {}).map((x) => x.variant), ['']);
	assert.deepEqual(canonGroups(null, 'quirk', {}), []);
});

test('saving drops empty variants and ones the series lacks', () => {
	const out = cleanBuild({ about: '', skills: [], variants: { Plus: { about: '', skills: [] }, Maximum: { about: 'x', skills: [] }, Bogus: { about: 'y', skills: [] } } }, 'quirk');
	assert.deepEqual(Object.keys(out.variants), ['Maximum']);
	assert.deepEqual(cleanBuild(build, 'jojo').variants, {});
});
