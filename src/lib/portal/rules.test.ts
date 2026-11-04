// Run with: node --test src/lib/portal/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardPath, checkSheet, power, ptp, recoil, systemLimit, traitSlots, type Issue } from './rules.ts';
import { emptySheet, normalizeSheet, type Sheet } from './sheet.ts';

const ocCtx = { kind: 'oc' as const, name: 'Kaito' };

function goodSheet(): Sheet {
	const s = emptySheet();
	s.role = 'villain';
	s.appearance.description = 'Tall.';
	s.lore.backstory = 'Born somewhere.';
	s.lore.personality = 'Calm.';
	s.potential.grade = 'average';
	s.stats = { ...s.stats, phase: 0, strength: '1A', speed: '1A', defense: '1B', stamina: '1C' };
	return s;
}

const messages = (issues: Issue[], level?: Issue['level']) => issues.filter((i) => !level || i.level === level).map((i) => i.message);

test('a complete starting sheet has no errors or warnings', () => {
	assert.deepEqual(checkSheet(goodSheet(), ocCtx), []);
});

test('power is the average of Strength and Speed values', () => {
	const s = goodSheet();
	s.stats.strength = '2F'; // 7
	s.stats.speed = '1A'; // 6
	assert.equal(power(s), 6.5);
});

test('recoil follows the wiki examples', () => {
	const valid = goodSheet();
	Object.assign(valid.stats, { strength: '7A', speed: '8F', defense: '8E' });
	assert.equal(recoil(valid), null);

	const bad = goodSheet();
	Object.assign(bad.stats, { strength: '8D', speed: '6E', defense: '3B' });
	const r = recoil(bad);
	assert.equal(r?.level, 3);
	assert.equal(r?.high, 'Strength');
	assert.equal(r?.low, 'Defense');
});

test('recoil levels: 3 off = Lv 1, 4 off = Lv 2, 5+ off = Lv 3', () => {
	const s = goodSheet();
	// 1A = 6; 1D = 3, 1E = 2, 1F = 1
	for (const [defense, level] of [['1D', 1], ['1E', 2], ['1F', 3]] as const) {
		Object.assign(s.stats, { strength: '1A', speed: '1A', defense });
		assert.equal(recoil(s)?.level, level, `defense ${defense}`);
	}
	Object.assign(s.stats, { strength: '1A', speed: '1A', defense: '1C' });
	assert.equal(recoil(s), null);
});

test('PTP: role start vs spent sub-tiers, intelligence and phase hops', () => {
	const s = goodSheet(); // 1A(6)+1A(6)+1B(5)+1C(4) from 1F(1) = 5+5+4+3 = 17
	assert.deepEqual([ptp(s).spent, ptp(s).available], [17, 20]);
	s.stats.intelligence = 'Above Average';
	assert.equal(ptp(s).spent, 27);
	assert.match(messages(checkSheet(s, ocCtx), 'error').join(), /spending 27 PTP, but you start with 20/);
	s.stats.earnedPtp = 50; // PTP earned in RP never counts toward a new character's budget
	assert.equal(ptp(s).available, 20);
	assert.deepEqual(checkSheet(s, { ...ocCtx, isEvolution: true }).filter((i) => /PTP/.test(i.message)), []);
	s.stats.intelligence = 'Average';
	s.stats.phase = 1;
	assert.equal(ptp(s).spent, 17 + 15);
});

test('Conduits get +10 PTP, Ghouls get none but start at 4C', () => {
	const s = goodSheet();
	s.systems = [{ key: 'a', system: 'infamous', fields: { class: 'Psychic' }, description: '', skills: [], rollProofs: {} }];
	assert.equal(ptp(s).available, 30);
	s.systems = [{ key: 'a', system: 'tokyo-ghoul', fields: { path: 'Ghoul' }, description: '', skills: [], rollProofs: {} }];
	Object.assign(s.stats, { strength: '4C', speed: '4C', defense: '1F', stamina: '1F' });
	assert.deepEqual([ptp(s).spent, ptp(s).available], [0, 0]);
});

test('trait slots by rarity, family traits take one slot', () => {
	const s = goodSheet();
	s.traits = [{ name: 'Genius' }, { name: 'Lazy' }]; // Rare 2 + Common 1
	assert.deepEqual(traitSlots(s), { used: 3, total: 4 });
	s.traits.push({ name: 'Anomalous Body' }); // Legendary 3
	assert.match(messages(checkSheet(s, ocCtx), 'error').join(), /take 6 slots, but you only have 4/);
	s.traits[2].family = true;
	assert.equal(traitSlots(s).used, 4);
	assert.equal(traitSlots(s, 2).total, 6);
});

test('unknown and duplicate traits are errors', () => {
	const s = goodSheet();
	s.traits = [{ name: 'Lazy', rollProof: 'https://discord.com/x' }, { name: 'Lazy', rollProof: 'x' }, { name: 'Made Up', rollProof: 'x' }];
	const errors = messages(checkSheet(s, ocCtx), 'error').join();
	assert.match(errors, /picked twice/);
	assert.match(errors, /isn’t a known trait/);
});

test('potential limits the phase and tiers', () => {
	const s = goodSheet();
	s.potential.grade = 'limited';
	s.stats.phase = 1;
	s.stats.strength = '3F';
	const warnings = messages(checkSheet(s, ocCtx), 'warning').join();
	assert.match(warnings, /Limited Potential can’t reach Phase 1/);
	assert.match(warnings, /stops at Tier 2/);
	s.potential.grade = 'apex';
	assert.match(messages(checkSheet(s, ocCtx), 'permission').join(), /rolled by staff/);
});

test('system budgets, move limits, permission picks and required fields', () => {
	const s = goodSheet();
	s.systems = [
		{
			key: 'a',
			system: 'abilities',
			fields: { classes: ['God'], power: 'Puny', range: 'Medium' }, // 2 + 2 = 4 points: OK
			description: '',
			skills: [
				{ name: 'A', type: 'standard', effect: '', mastery: '' },
				{ name: 'B', type: 'standard', effect: '', mastery: '' },
				{ name: 'C', type: 'standard', effect: '', mastery: '' },
				{ name: 'D', type: 'passive', effect: '', mastery: '' },
			],
			rollProofs: {},
		},
	];
	let issues = checkSheet(s, ocCtx);
	assert.match(messages(issues, 'permission').join(), /God \(Ability class\(es\)\) needs permission/);
	assert.match(messages(issues, 'permission').join(), /custom passive “D”/);
	assert.match(messages(issues, 'warning').join(), /3 Standard skills, but you can start with 2/);
	assert.doesNotMatch(messages(issues).join(), /Ability Tier Points/);
	s.systems[0].fields.power = 'Insignificant'; // 3 + 2 = 5
	assert.match(messages(checkSheet(s, ocCtx), 'warning').join(), /5 Ability Tier Points spent, but you start with 4/);

	s.systems.push({ key: 'b', system: 'jojo', fields: { path: 'Stand' }, description: '', skills: [], rollProofs: {} });
	issues = checkSheet(s, ocCtx);
	assert.match(messages(issues, 'error').join(), /pick your priority system/);
	assert.match(messages(issues, 'error').join(), /fill in Stand name/);
});

test('Ghouls cannot be combined with other systems except Chainsaw Man', () => {
	const s = goodSheet();
	const ghoul = { key: 'g', system: 'tokyo-ghoul', fields: { path: 'Ghoul', kagune: 'Ukaku' }, description: '', skills: [], rollProofs: { kagune: 'https://x' } };
	s.systems = [ghoul, { key: 'c', system: 'chainsaw-man', fields: { path: 'Human with contracts', contracts: [] }, description: '', skills: [], rollProofs: {} }];
	s.prioritySystem = 'g';
	Object.assign(s.stats, { strength: '4C', speed: '4C', defense: '1F', stamina: '1F' }); // Ghouls get no PTP
	assert.deepEqual(messages(checkSheet(s, ocCtx), 'error'), []);
	s.systems.push({ key: 'q', system: 'quirk', fields: { type: 'Emitter' }, description: '', skills: [], rollProofs: {} });
	assert.match(messages(checkSheet(s, ocCtx), 'error').join(), /can’t be combined with My Hero Academia/);
});

test('contracts need a price, what they grant and a punishment', () => {
	const s = goodSheet();
	s.systems = [
		{
			key: 'c',
			system: 'chainsaw-man',
			fields: { path: 'Human with contracts', contracts: [{ devil: 'Fox', type: 'Summoning', price: 'a finger', grants: 'bites', punishment: '' }] },
			description: '',
			skills: [],
			rollProofs: {},
		},
	];
	assert.match(messages(checkSheet(s, ocCtx), 'error').join(), /Contracts #1 is missing “Punishment for breaking it”/);
});

test('full canon claims block sending, unless already held', () => {
	const s = goodSheet();
	const claims = new Map([['x', { name: 'Cloning', usedSlots: 2, maxUsers: 2 }]]);
	assert.match(messages(checkSheet(s, { ...ocCtx, claims, requestedClaims: ['x'] }), 'error').join(), /Cloning is already full \(2\/2\)/);
	assert.deepEqual(checkSheet(s, { ...ocCtx, claims, requestedClaims: ['x'], heldClaimIds: new Set(['x']) }), []);
});

test('canon tryouts use the lighter sheet', () => {
	const s = emptySheet();
	const ctx = { kind: 'canon' as const, name: 'Satoru Gojo', canonUniverse: 'jujutsu-kaisen' };
	assert.deepEqual(messages(checkSheet(s, ctx), 'error'), ['Explain how you’ll portray this character.', 'Add a short roleplay sample.']);
	s.canon = { portrayal: 'Smug.', sample: 'Throughout heaven and earth…' };
	assert.deepEqual(checkSheet(s, ctx), []);
});

test('normalizeSheet fills in missing parts', () => {
	const s = normalizeSheet({ lore: { backstory: 'x' }, systems: [{ key: 'a', system: 'quirk', fields: {} }] });
	assert.equal(s.lore.backstory, 'x');
	assert.equal(s.lore.personality, '');
	assert.deepEqual(s.systems[0].skills, []);
	assert.deepEqual(s.traits, []);
});

const card = (key: string, system: string, fields = {}, skills: { name: string; type: 'standard' | 'ultimate' | 'passive' }[] = []) => ({
	key,
	system,
	fields,
	description: '',
	skills: skills.map((s) => ({ ...s, effect: '', mastery: '' })),
	rollProofs: {},
});

test('one of each power set, except Abilities and Quirks', () => {
	const s = goodSheet();
	s.prioritySystem = 'a';
	s.systems = [card('a', 'abilities', { classes: ['Generation'] }, [{ name: 'x', type: 'standard' }]), card('b', 'abilities', { classes: ['Generation'] }, [{ name: 'y', type: 'standard' }])];
	assert.doesNotMatch(messages(checkSheet(s, ocCtx), 'error').join(), /only have/);
	s.systems.push(card('c', 'fire-force', { generation: 'Second', theme: 'Ash' }), card('d', 'fire-force', { generation: 'Second', theme: 'Ash' }));
	assert.match(messages(checkSheet(s, ocCtx), 'error').join(), /only have one Fire Force power set, but you have 2/);
	assert.equal(systemLimit(s, 'abilities'), Infinity);
	assert.equal(systemLimit(s, 'quirk'), Infinity);
});

test('Dual Gift allows 2 Cursed Techniques and Conduits; combinations can raise limits further', () => {
	const s = goodSheet();
	assert.equal(systemLimit(s, 'jujutsu-kaisen'), 1);
	s.traits = [{ name: 'Dual Gift' }];
	assert.equal(systemLimit(s, 'jujutsu-kaisen'), 2);
	assert.equal(systemLimit(s, 'infamous'), 2);
	assert.equal(systemLimit(s, 'jojo'), 1);
	assert.equal(systemLimit(s, 'jujutsu-kaisen', [{ 'jujutsu-kaisen': 3 }]), 3);
});

test('starting skills: at least one less than the maximum', () => {
	const s = goodSheet();
	s.systems = [card('q', 'quirk', { type: 'Emitter' }, [{ name: 'a', type: 'standard' }])]; // needs 2 standard + 1 ultimate
	const errors = messages(checkSheet(s, ocCtx), 'error').join();
	assert.match(errors, /add at least 2 Standard skills \(you have 1\)/);
	assert.match(errors, /add at least 1 Ultimate skill \(you have 0\)/);
	s.systems = [card('j', 'jujutsu-kaisen', { ceClass: 'Common', ceAmount: 100 }, [])];
	assert.match(messages(checkSheet(s, ocCtx), 'error').join(), /add at least 1 Extension Technique \(you have 0\)/);
	s.systems[0].skills = [{ name: 'Ext', type: 'standard', effect: '', mastery: '' }];
	assert.doesNotMatch(messages(checkSheet(s, ocCtx), 'error').join(), /Extension/);
	s.systems = [card('a', 'abilities', { classes: ['Generation'] }, [])]; // needs 1 standard, 0 ultimate
	assert.deepEqual(messages(checkSheet(s, ocCtx), 'error'), ['Abilities: add at least 1 Standard skill (you have 0).']);
});

test('Family Locked claims need permission', () => {
	const s = goodSheet();
	const claims = new Map([['l', { name: 'Limitless', usedSlots: 0, maxUsers: null, category: 'Family Locked' }]]);
	assert.match(messages(checkSheet(s, { ...ocCtx, claims, requestedClaims: ['l'] }), 'permission').join(), /Limitless is Family Locked: pick the family/);
	const withFamily = checkSheet(s, { ...ocCtx, claims, requestedClaims: ['l'], families: ['f1'] }).filter((i) => i.level === 'permission');
	assert.match(withFamily.map((i) => i.message).join(), /family that holds it \(or an admin\) confirms it/);
	assert.equal(withFamily[0].section, 'Families');
});

test('JoJo: only Stands are limited to one', () => {
	const s = goodSheet();
	s.prioritySystem = 'h';
	s.systems = [card('h', 'jojo', { path: 'Hamon' }), card('p', 'jojo', { path: 'Spin' }), card('v', 'jojo', { path: 'Vampire' })];
	assert.doesNotMatch(messages(checkSheet(s, ocCtx), 'error').join(), /only have/);
	const stand = { path: 'Stand', standName: 'A', standDestructivePower: 'E', standSpeed: 'E', standRange: 'E', standDurability: 'E', standPrecision: 'E', standDevelopmentalPotential: 'E' };
	s.systems.push(card('s1', 'jojo', stand));
	assert.doesNotMatch(messages(checkSheet(s, ocCtx), 'error').join(), /only have/);
	s.systems.push(card('s2', 'jojo', { ...stand, standName: 'B' }));
	assert.match(messages(checkSheet(s, ocCtx), 'error').join(), /You can only have one Stand, but you have 2/);
});

test('traits change starting PTP: Physically Fit +5, Lazy −5, Frail Body none', () => {
	const s = goodSheet(); // Villain: 20 starting PTP, spends 17
	s.traits = [{ name: 'Physically Fit' }];
	assert.deepEqual([ptp(s).available, ptp(s).traitBonus], [25, 5]);
	s.traits = [{ name: 'Lazy' }];
	assert.equal(ptp(s).available, 15);
	assert.match(messages(checkSheet(s, ocCtx), 'error').join(), /spending 17 PTP, but you start with 15 \(20 from your role, 0 from systems, -5 from traits\)/);
	s.traits = [{ name: 'Frail Body' }];
	Object.assign(s.stats, { strength: '1F', speed: '1F', defense: '1F', stamina: '1E' });
	assert.deepEqual([ptp(s).spent, ptp(s).available, ptp(s).noPtp], [0, 0, true]); // 1E Stamina is free for Frail Body
	assert.doesNotMatch(messages(checkSheet(s, ocCtx), 'error').join(), /PTP/);
	s.stats.strength = '1E';
	assert.match(messages(checkSheet(s, ocCtx), 'error').join(), /start with 0 \(none/);
});

test('a missing Cursed Energy roll is reported once', () => {
	const s = goodSheet();
	s.systems = [{ key: 'j', system: 'jujutsu-kaisen', fields: {}, description: '', skills: [{ name: 'x', type: 'standard', effect: '', mastery: '' }], rollProofs: {} }];
	const ce = messages(checkSheet(s, ocCtx), 'error').filter((m) => m.includes('Cursed Energy'));
	assert.deepEqual(ce, ['Jujutsu Kaisen: roll your Cursed Energy.']);
});

test('cyberware: catalog slots, slot counts, and starting with any needs permission', () => {
	const s = goodSheet();
	const cyber = (items: Record<string, string>[]) => [{ key: 'c', system: 'cyberpunk', fields: { start: 'Powered', cyberware: items }, description: '', skills: [], rollProofs: {} }];
	s.systems = cyber([
		{ name: 'Basic Kiroshi Optics', slot: 'Ocular', grade: 'Civilian', tier: '1' },
		{ name: 'Reflex Tuner', slot: 'Nervous System', grade: 'Civilian', tier: '1' },
		{ name: 'Kerenzikov', slot: 'Nervous System', grade: 'Civilian', tier: '1' },
	]);
	assert.deepEqual(messages(checkSheet(s, ocCtx), 'error'), []);
	assert.equal(messages(checkSheet(s, ocCtx), 'permission').filter((m) => /starting with/.test(m)).length, 3, 'every starting piece needs permission');
	assert.deepEqual(checkSheet(s, { ...ocCtx, isEvolution: true }).filter((i) => /Cyberware/.test(i.message)), [], 'approved characters can have it');

	s.systems = cyber([
		{ name: 'Basic Kiroshi Optics', slot: 'Ocular', grade: 'Civilian', tier: '1' },
		{ name: 'Kiroshi Sentry Optics', slot: 'Ocular', grade: 'Civilian', tier: '1' },
		{ name: 'Mantis Blades', slot: 'Legs', grade: 'Military', tier: '3' },
		{ name: 'Other (not on the list)', custom: '', slot: 'Face', grade: 'Modified', tier: '1' },
	]);
	const errors = messages(checkSheet(s, { ...ocCtx, isEvolution: true }), 'error').join(' | ');
	assert.match(errors, /2 pieces in Ocular, but it has 1 slot/);
	assert.match(errors, /Mantis Blades goes in Arms, not Legs/);
	assert.match(errors, /write the name of the Other cyberware/);
	const perms = messages(checkSheet(s, { ...ocCtx, isEvolution: true }), 'permission').join(' | ');
	assert.match(perms, /isn’t on the cyberware list/);
	assert.match(perms, /is Modified/);
});

test('a Family trait needs a family', () => {
	const s = goodSheet();
	s.traits = [{ name: 'Genius', family: true, rollProof: 'https://x' }];
	assert.match(messages(checkSheet(s, ocCtx), 'error').join(), /Family trait needs a family/);
	assert.doesNotMatch(messages(checkSheet(s, { ...ocCtx, families: ['f1'] }), 'error').join(), /Family trait needs a family/);
});

test('old sheets get an empty families list', () => {
	assert.deepEqual(normalizeSheet({}).families, []);
	assert.deepEqual(normalizeSheet({ families: ['a', 3] }).families, ['a']);
});

test('trait start effects from the trait list', () => {
	// Endurance Star: Stamina starts at 6F, so it costs no PTP and isn't above Phase 0.
	const star = goodSheet();
	star.traits = [{ name: 'Endurance Star' }];
	star.stats.stamina = '6F';
	assert.equal(ptp(star).spent, ptp(goodSheet()).spent - 3); // goodSheet's 1C stamina cost 3
	const msgs = messages(checkSheet(star, ocCtx));
	assert.ok(!msgs.some((m) => m.includes('Stamina (6F)')), msgs.join('\n'));
	assert.ok(!msgs.some((m) => m.includes('roll link')), 'no roll links');

	// Genius starts Intelligence at Genius for free; Impaired Cognitive Skills makes Average cost PTP.
	const genius = goodSheet();
	genius.traits = [{ name: 'Genius' }];
	genius.stats.intelligence = 'Genius';
	assert.equal(ptp(genius).spent, ptp(goodSheet()).spent);
	const impaired = goodSheet();
	impaired.traits = [{ name: 'Impaired Cognitive Skills' }];
	assert.equal(ptp(impaired).spent, ptp(goodSheet()).spent + 10);

	// Unnatural Body: everything starts at 1A, and recoil starts after 3 Sub-Tiers apart.
	const unnatural = goodSheet();
	unnatural.traits = [{ name: 'Unnatural Body' }];
	assert.equal(ptp(unnatural).spent, 0);
	Object.assign(unnatural.stats, { strength: '2D', speed: '1A', defense: '1A' }); // 3 apart
	assert.equal(recoil(unnatural), null);
	assert.equal(ptp({ ...goodSheet(), traits: [{ name: 'Body Of Adaptation' }] }).traitBonus, 5);
});

test('trait bonuses to system points, and JJK with only Cursed Energy Utilization', () => {
	const s = goodSheet();
	s.traits = [{ name: 'Endurance Star' }];
	s.systems = [
		{ key: 'f', system: 'fire-force', fields: { generation: 'Third', theme: 'Sun', power: 4, oxygenTank: 1, efficiency: 4, absorption: 4 }, description: '', skills: [], rollProofs: {} },
		{ key: 'j', system: 'jujutsu-kaisen', fields: { start: 'Cursed Energy Utilization only', ceClass: 'Common', ceAmount: 100 }, description: '', skills: [], rollProofs: {} },
	];
	s.prioritySystem = 'f';
	const msgs = messages(checkSheet(s, ocCtx));
	assert.ok(!msgs.some((m) => m.includes('Fire Force Tier Points spent')), msgs.join('\n'));
	assert.ok(!msgs.some((m) => m.includes('Extension Technique')), msgs.join('\n'));
	s.systems[1].fields.start = 'Cursed Technique';
	assert.ok(messages(checkSheet(s, ocCtx)).some((m) => m.includes('Extension Technique')));
});

test('staff-granted bonus PTP raises the starting budget', () => {
	const s = { ...goodSheet(), role: 'student', stats: { ...goodSheet().stats, strength: '2D', speed: '2D', defense: '2C', stamina: '6F', intelligence: 'Average', phase: 0 }, traits: [{ name: 'Endurance Star' }] };
	assert.deepEqual([ptp(s).spent, ptp(s).available], [25, 10]);
	assert.equal(ptp(s, 15).available, 25);
	assert.ok(!checkSheet(s, { kind: 'oc', name: 'X', bonusPtp: 15 }).some((i) => i.message.includes('PTP')));
	assert.ok(checkSheet(s, { kind: 'oc', name: 'X' }).some((i) => i.message.includes('15 granted') === false && i.message.includes('PTP')));
});

test('custom skill trees: problems block sending, new custom rates need permission', () => {
	const tree = {
		name: 'Commune Mastery',
		currency: 'CUSTOM',
		custom: { name: 'Wisp Points', code: 'WP', gain: 3, convertFrom: 'AUP', convertFromAmount: 5, convertToAmount: 1 },
		nodes: [
			{ id: 'r', label: 'Start', description: '', cost: 0, requires: [], start: true },
			{ id: 'a', label: 'Swarm', description: '', cost: 2, requires: ['r'], start: false },
		],
	};
	const sheet = goodSheet();
	const card = { key: 'c1', system: 'abilities', fields: { classes: ['Manipulation'], power: 'Average', range: 'Close', upgradePoints: 0 }, description: '', skills: [], rollProofs: {}, customTree: structuredClone(tree) };
	sheet.systems = [card];
	const issues = checkSheet(sheet, { kind: 'oc', name: 'X' });
	assert.ok(issues.some((i) => i.level === 'permission' && i.message.includes('Wisp Points')));
	assert.deepEqual(issues.filter((i) => i.level === 'error' && /custom|tree/.test(i.message)), []);
	// Approved with the same rates: no permission needed again.
	const approved = structuredClone(sheet);
	assert.ok(!checkSheet(sheet, { kind: 'oc', name: 'X', approvedSheet: approved }).some((i) => i.message.includes('Wisp Points')));
	// A loop and a missing name are errors.
	card.customTree.name = '';
	card.customTree.nodes[0].requires = ['a'];
	const errors = checkSheet(sheet, { kind: 'oc', name: 'X' }).filter((i) => i.level === 'error').map((i) => i.message);
	assert.ok(errors.some((m) => m.includes('name the custom skill tree')));
	assert.ok(errors.some((m) => m.includes('circle')));
});

test('JJK starting stats: past them needs a stat override with a reason', () => {
	const s = goodSheet();
	s.systems = [
		{
			key: 'j',
			system: 'jujutsu-kaisen',
			fields: { start: 'Cursed Technique', ceClass: 'Rare', ceAmount: 500, ceOutput: 'High', ctRange: 'Close', ctPower: 'Grade 2', ceControl: 3 },
			description: '',
			skills: [],
			rollProofs: {},
		},
	];
	s.prioritySystem = 'j';
	const msgs = (level: string) => checkSheet(s, ocCtx).filter((i) => i.level === level && i.message.includes('Jujutsu')).map((i) => i.message);
	assert.equal(msgs('error').filter((m) => m.includes('stat override')).length, 3);
	assert.ok(!msgs('error').some((m) => m.includes('Cursed Technique Range')), 'Close range is a starting choice');
	s.systems[0].statOverride = { reason: '' };
	assert.ok(msgs('error').some((m) => m.includes('explain why')));
	s.systems[0].statOverride = { reason: 'Staff OK in ticket 12' };
	assert.ok(!msgs('error').some((m) => m.includes('override')));
	assert.ok(msgs('permission').some((m) => m.includes('Cursed Energy Output High') && m.includes('ticket 12')));
	// Evolutions aren't held to the starting stats.
	s.systems[0].statOverride = null;
	assert.ok(!checkSheet(s, { ...ocCtx, isEvolution: true }).some((i) => i.message.includes('stat override')));
});

const jjk = (fields: Record<string, unknown>) => ({ key: 'j', system: 'jujutsu-kaisen', fields: { start: 'Cursed Technique', ceClass: 'Rare', ceAmount: 500, ...fields }, description: '', skills: [], rollProofs: {} }) as Sheet['systems'][number];

test('Heavenly Restriction: needs a grant, only JJK and Cyberpunk', () => {
	const s = goodSheet();
	s.systems = [jjk({ heavenlyRestriction: 'Cursed Energy' }), { key: 'a', system: 'abilities', fields: {}, description: '', skills: [], rollProofs: {} }];
	s.prioritySystem = 'j';
	s.stats = { ...s.stats, phase: 2, strength: '13F', speed: '13F', defense: '13F', stamina: '13F', intelligence: 'Gifted' };
	const errors = (grant: string | null) => messages(checkSheet(s, { ...ocCtx, heavenlyGrant: grant }), 'error').filter((m) => m.includes('Heavenly'));
	assert.ok(errors(null).some((m) => m.includes('isn’t granted')));
	assert.ok(errors('Physical').some((m) => m.includes('you were granted Physical')));
	assert.ok(errors('Cursed Energy').some((m) => m.includes('Remove Abilities')));
	s.systems = [s.systems[0], { key: 'c', system: 'cyberpunk', fields: {}, description: '', skills: [], rollProofs: {} }];
	assert.deepEqual(errors('Cursed Energy').filter((m) => !m.includes('Cursed Energy Utilization')), []);
});

test('Cursed Energy Restriction: fixed 13F and Gifted, no bonus PTP, free hops to Phase 2, no CE or CT fields', () => {
	const s = goodSheet();
	s.systems = [jjk({ heavenlyRestriction: 'Cursed Energy', start: 'Cursed Energy Utilization only' })];
	s.prioritySystem = 'j';
	s.stats = { ...s.stats, phase: 2, strength: '13F', speed: '13F', defense: '13F', stamina: '13F', intelligence: 'Gifted' };
	const base = ptp(s);
	assert.equal(base.spent, 0);
	assert.equal(base.bonus, 0);
	const all = checkSheet(s, { ...ocCtx, heavenlyGrant: 'Cursed Energy' });
	assert.ok(!all.some((i) => i.level === 'error' && i.message.includes('Heavenly')), 'the fixed stats pass');
	s.stats.strength = '13E';
	s.stats.intelligence = 'Genius';
	const locked = messages(checkSheet(s, { ...ocCtx, heavenlyGrant: 'Cursed Energy' }), 'error');
	assert.ok(locked.some((m) => m.includes('Strength is set to 13F')));
	assert.ok(locked.some((m) => m.includes('Intelligence is set to Gifted')));
	assert.ok(!all.some((i) => i.message.includes('roll your Cursed Energy')), 'no CE to roll');
	assert.ok(!all.some((i) => i.message.includes('Extension Technique')), 'no CT moves needed');
});

test('Physical Restriction locks stats at 1G (Power −1); Equilibrium follows the CE class', () => {
	const s = goodSheet();
	s.systems = [jjk({ heavenlyRestriction: 'Physical', ceClass: 'Heavenly', ceAmount: 12000, ceControl: 5, ctRange: 'Heavenly' })];
	s.prioritySystem = 'j';
	s.stats = { ...s.stats, phase: 0, strength: '1G', speed: '1G', defense: '1G', stamina: '1G' };
	assert.equal(power(s), -1);
	const errs = () => messages(checkSheet(s, { ...ocCtx, heavenlyGrant: 'Physical' }), 'error');
	assert.ok(!errs().some((m) => m.includes('Heavenly') || m.includes('stat override')), errs().join('\n'));
	s.stats.speed = '1A';
	assert.ok(errs().some((m) => m.includes('Speed is set to 1G')));

	s.systems = [jjk({ heavenlyRestriction: 'Equilibrium', ceClass: 'Legendary' })];
	s.stats = { ...s.stats, phase: 1 };
	assert.ok(errs().some((m) => m.includes('Phase 2')));
});

test('staff overrides: staff-set stats cost no PTP and skip starting limits; progressed skips them all', () => {
	const s = goodSheet();
	s.stats = { ...s.stats, phase: 2, strength: '12A', speed: '12A' };
	const errs = (extra: object) => messages(checkSheet(s, { ...ocCtx, ...extra }), 'error').concat(messages(checkSheet(s, { ...ocCtx, ...extra }), 'warning'));
	assert.ok(errs({}).some((m) => m.includes('PTP')), 'too many PTP without staff');
	const staff = { 'stats.strength': { by: 'Admin' }, 'stats.speed': { by: 'Admin' }, 'stats.phase': { by: 'Admin' } };
	assert.equal(ptp(s, 0, staff).spent, ptp(goodSheet(), 0).spent - 10, 'only Defense and Stamina still cost PTP');
	assert.ok(!errs({ staffOverrides: staff }).some((m) => m.includes('PTP') || m.includes('Phase')), errs({ staffOverrides: staff }).join('\n'));

	s.systems = [{ key: 'j', system: 'jujutsu-kaisen', fields: { start: 'Cursed Technique', ceClass: 'Rare', ceAmount: 500, ceOutput: 'High' }, description: '', skills: [], rollProofs: {} }];
	s.prioritySystem = 'j';
	assert.ok(errs({ staffOverrides: staff }).some((m) => m.includes('stat override')));
	assert.ok(!errs({ staffOverrides: { ...staff, [cardPath('j', 'ceOutput')]: {} } }).some((m) => m.includes('stat override')));
	assert.ok(!errs({ progressed: true }).some((m) => m.includes('PTP') || m.includes('stat override')));
});
