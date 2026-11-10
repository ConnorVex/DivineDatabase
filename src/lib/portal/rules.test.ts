// Run with: node --test src/lib/portal/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyApproved, approvedText, cardPath, checkSheet, ENCRYPTION_ITEM, power, ptp, recoil, systemLimit, traitSlots, type Issue } from './rules.ts';
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
	assert.match(messages(checkSheet(s, ocCtx), 'error').join(), /5 Ability Tier Points spent, but you start with 4\. Ask for a stat override/);

	s.systems.push({ key: 'b', system: 'jojo', fields: { hasStand: 'Yes' }, description: '', skills: [], rollProofs: {} });
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

test('approved canons can add any system and evolve, with no stats or Potential required', () => {
	const s = emptySheet();
	s.canon = { portrayal: 'Smug.', sample: 'Throughout heaven and earth…' };
	const ctx = { kind: 'canon' as const, name: 'Satoru Gojo', canonUniverse: 'jujutsu-kaisen', isEvolution: true };
	assert.deepEqual(messages(checkSheet(s, ctx), 'error'), []);
	// A system from another series is checked like any OC's card.
	s.systems = [{ key: 'q', system: 'quirk', fields: {}, description: '', skills: [], rollProofs: {} }];
	assert.ok(checkSheet(s, ctx).some((i) => i.section === 'Systems'));
	// The tryout itself still skips them.
	assert.ok(!checkSheet(s, { ...ctx, isEvolution: false }).some((i) => i.section === 'Systems'));
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

test('a Cursed Technique has a single Maximum Technique', () => {
	const s = goodSheet();
	const ext = { name: 'Ext', type: 'standard' as const };
	s.systems = [card('j', 'jujutsu-kaisen', { ceClass: 'Common', ceAmount: 100 }, [ext, { name: 'Max', type: 'ultimate' }])];
	assert.doesNotMatch(messages(checkSheet(s, ocCtx), 'error').join(), /Maximum Technique/);
	s.systems[0].skills.push({ name: 'Max 2', type: 'ultimate', effect: '', mastery: '' });
	assert.match(messages(checkSheet(s, ocCtx), 'error').join(), /only 1 Maximum Technique allowed \(you have 2\)/);
});

test('Family Locked claims need permission', () => {
	const s = goodSheet();
	const claims = new Map([['l', { name: 'Limitless', usedSlots: 0, maxUsers: null, category: 'Family Locked' }]]);
	assert.match(messages(checkSheet(s, { ...ocCtx, claims, requestedClaims: ['l'] }), 'permission').join(), /Limitless is Family Locked: only the family that holds it can give it/);
	const withFamily = checkSheet(s, { ...ocCtx, claims, requestedClaims: ['l'], families: ['f1'] }).filter((i) => i.level === 'permission');
	assert.match(withFamily.map((i) => i.message).join(), /family that holds it \(or an admin\) confirms it/);
	assert.equal(withFamily[0].section, 'Families');
});

test('JoJo: start with a Stand; Hamon and Vampirism need permission, Spin the Spinning Soul trait; Hamon and Vampirism never together', () => {
	const s = goodSheet();
	s.prioritySystem = 'j';
	const stand = { hasStand: 'Yes', standName: 'A', standDestructivePower: 'E', standSpeed: 'E', standRange: 'E', standDurability: 'E', standPrecision: 'E', standDevelopmentalPotential: 'E' };
	s.systems = [card('j', 'jojo', stand)];
	assert.deepEqual(messages(checkSheet(s, ocCtx), 'error'), []);
	assert.deepEqual(messages(checkSheet(s, ocCtx), 'permission'), []);

	s.systems = [card('j', 'jojo', { ...stand, hamon: 'Yes', spin: 'Yes' })];
	const perms = messages(checkSheet(s, ocCtx), 'permission').join(' | ');
	assert.match(perms, /starting with Hamon needs permission/);
	assert.ok(messages(checkSheet(s, ocCtx), 'error').some((m) => m.includes('Spin needs The Spinning Soul trait')));

	s.traits = [{ name: 'Spinning Soul' }] as Sheet['traits'];
	s.systems = [card('j', 'jojo', { hasStand: 'No', vampire: 'Yes', spin: 'Yes' })];
	assert.deepEqual(messages(checkSheet(s, ocCtx), 'error'), [], 'a Vampire can have Spin, no Stand needed');
	s.traits = [];
	s.systems = [card('j', 'jojo', { ...stand, vampire: 'Yes', hamon: 'Yes' })];
	assert.match(messages(checkSheet(s, ocCtx), 'error').join(), /Hamon and Vampirism can’t go together/);
	s.systems = [card('j', 'jojo', { hasStand: 'No' })];
	assert.match(messages(checkSheet(s, ocCtx), 'error').join(), /start with a Stand/);
	s.systems = [card('j', 'jojo', { ...stand, hamonGaugeUp: 2 })];
	assert.match(messages(checkSheet(s, ocCtx), 'error').join(), /Capacity upgrades come after approval/);

	// After approval: upgrades and a Stand from an Arrow go to staff.
	const approved = goodSheet();
	approved.systems = [card('j', 'jojo', { hasStand: 'No', hamon: 'Yes' })];
	s.systems = [card('j', 'jojo', { ...stand, standArrow: 'Stand Arrow', hamon: 'Yes', hamonGaugeUp: 8 })];
	const evo = messages(checkSheet(s, { ...ocCtx, isEvolution: true, approvedSheet: approved }), 'permission').join(' | ');
	assert.match(evo, /Capacity upgrade Max; staff check the HUP/);
	assert.match(evo, /gained a Stand/);
});

test('JoJo cards from before the rework keep their path', () => {
	const s = normalizeSheet({ systems: [{ key: 'j', system: 'jojo', fields: { path: 'Ultimate Life Form' } }] });
	assert.deepEqual(s.systems[0].fields, { hasStand: 'No', vampire: 'Yes', ulf: 'Yes' });
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

test('cyberware: catalog slots, slot counts, Skill Tree slots, and locked until approval', () => {
	const s = goodSheet();
	const cyber = (items: Record<string, string>[]) => [{ key: 'c', system: 'cyberpunk', fields: { start: 'Powered', cyberware: items }, description: '', skills: [], rollProofs: {} }];
	s.systems = cyber([
		{ name: 'Basic Kiroshi Optics', slot: 'Ocular', grade: 'Civilian', tier: '1' },
		{ name: 'Reflex Tuner', slot: 'Nervous System', grade: 'Civilian', tier: '1' },
		{ name: 'Kerenzikov', slot: 'Nervous System', grade: 'Civilian', tier: '1' },
	]);
	assert.deepEqual(messages(checkSheet(s, ocCtx), 'error'), ['Cyberpunk 2077: Cyberware is locked until your character is approved. Staff can unlock it for you.']);
	assert.deepEqual(messages(checkSheet(s, { ...ocCtx, staffOverrides: { 'card:c.cyberware': { to: [] } } }), 'error'), [], 'staff can unlock it');
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

	// Upgradeable slots grow with the Skill Tree; staff confirm each extra slot.
	s.systems = cyber([
		{ name: 'Smart Link', slot: 'Hands', grade: 'Civilian', tier: '1' },
		{ name: 'Ballistic Coprocessor', slot: 'Hands', grade: 'Civilian', tier: '1' },
	]);
	assert.match(messages(checkSheet(s, { ...ocCtx, isEvolution: true }), 'error').join(' | '), /2 pieces in Hands, but it has 1 slot/);
	(s.systems[0].fields as Record<string, unknown>).extraSlots = ['Hands', 'Ocular'];
	const after = checkSheet(s, { ...ocCtx, isEvolution: true });
	assert.ok(!messages(after, 'error').some((m) => /pieces in Hands/.test(m)));
	assert.ok(messages(after, 'error').some((m) => /Ocular slots can’t be upgraded/.test(m)));
	assert.ok(messages(after, 'permission').some((m) => /1 extra Hands slot from the Skill Tree/.test(m)));
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

test('JJK starting stats: past them needs a stat override with a reason', async () => {
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
	// Denied: the card goes back to the starting stats and the request is dropped.
	const { denyStatOverride, isStatOverride } = await import('./rules.ts');
	const issue = checkSheet(s, ocCtx).find(isStatOverride)!;
	assert.equal(issue.card, 'j');
	const denied = denyStatOverride(s, 'j');
	assert.equal(denied.systems[0].statOverride, undefined);
	assert.equal(denied.systems[0].fields.ceOutput, 'None');
	assert.equal(denied.systems[0].fields.ctRange, 'Close', 'starting choices stay');
	assert.ok(!checkSheet(denied, ocCtx).some((i) => i.message.includes('stat override')));
	// Evolutions aren't held to the starting stats.
	s.systems[0].statOverride = null;
	assert.ok(!checkSheet(s, { ...ocCtx, isEvolution: true }).some((i) => i.message.includes('stat override')));
	// A request that asks for nothing is flagged; one in words (a start set by a roll) is sent to staff.
	s.systems = [{ key: 't', system: 'tokyo-ghoul', fields: {}, description: '', skills: [], rollProofs: {}, statOverride: { reason: 'Event reward' } }];
	assert.ok(checkSheet(s, ocCtx).some((i) => i.level === 'warning' && i.message.includes('doesn\'t ask for anything')));
	s.systems[0].statOverride = { reason: 'Event reward', ask: 'A Grade 2 Rc Tank' };
	assert.ok(checkSheet(s, ocCtx).some((i) => i.level === 'permission' && i.message.includes('A Grade 2 Rc Tank')));
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

test('admin characters skip every rule; the Divine S.T.S needs Divine Potential', () => {
	const s = goodSheet();
	s.stats = { ...s.stats, phase: 4, strength: 'ΩSS+', speed: 'ΚF' };
	s.lore.backstory = '';
	const all = (extra: object) => checkSheet(s, { ...ocCtx, ...extra });
	assert.ok(messages(all({}), 'error').some((m) => m.includes('Divine Potential')), 'Divine ranks need Divine Potential');
	assert.deepEqual(all({ adminCharacter: true }), [], 'admin characters have no issues');
	assert.equal(power(s), (152 + 124) / 2, 'Divine ranks have values past 20A');
	s.potential.grade = 'divine';
	assert.ok(!messages(all({}), 'error').some((m) => m.includes('Divine')), messages(all({}), 'error').join('\n'));
});

test('an encryption request needs a reason and permission', () => {
	const s = goodSheet();
	const all = (extra: object) => checkSheet(s, { ...ocCtx, ...extra });
	assert.ok(messages(all({ encryptionRequest: { reason: '  ' } }), 'error').some((m) => m.includes('encrypted')), 'a blank reason is an error');
	const asked = messages(all({ encryptionRequest: { reason: 'Story reasons' } }), 'permission');
	assert.ok(asked.includes(`${ENCRYPTION_ITEM}: Story reasons`), asked.join('\n'));
	assert.ok(!messages(all({}), 'permission').some((m) => m.startsWith(ENCRYPTION_ITEM)), 'no request, no item');
});

test('approved requests show as approved, not as needing permission again', () => {
	const s = goodSheet();
	const issues = checkSheet(s, { ...ocCtx, encryptionRequest: { reason: 'Story reasons' } });
	const item = issues.find((i) => i.message.startsWith(ENCRYPTION_ITEM))!;
	const after = applyApproved(issues, [item.message]);
	assert.equal(after.find((i) => i.message === item.message)?.level, 'approved');
	assert.ok(!after.some((i) => i.level === 'permission' && i.message === item.message));
	assert.equal(approvedText(item.message), 'Encryption 🔒: Story reasons');
	assert.deepEqual(applyApproved(issues, []), issues, 'nothing approved, nothing changes');
});

test('Permission Based starts are flagged for staff and need their own fields', () => {
	const s = goodSheet();
	s.systems = [{ key: 'a', system: 'jujutsu-kaisen', fields: { start: 'Cursed Energy Utilization only', extras: ['Cursed Energy Property'] }, description: '', skills: [], rollProofs: {} }];
	const issues = checkSheet(s, ocCtx);
	assert.ok(messages(issues, 'permission').some((m) => m.includes('Cursed Energy Property')), messages(issues).join('\n'));
	assert.ok(messages(issues, 'error').some((m) => /Property/.test(m)), 'the property is required once picked');
	s.systems[0].fields = { start: 'Cursed Energy Utilization only' };
	assert.ok(!messages(checkSheet(s, ocCtx)).some((m) => /Cursed Energy Property/.test(m)), 'nothing picked, nothing asked');
});

test('locked tree skills don’t count toward the start, and can’t be unlocked by editing', () => {
	const s = goodSheet();
	const std = (name: string, extra: object = {}) => ({ name, type: 'standard' as const, effect: '', mastery: '', ...extra });
	s.systems = [{ key: 'a', system: 'quirk', fields: { type: 'Emitter' }, description: '', rollProofs: {}, skills: [std('A'), std('B'), std('C'), std('D', { treeNodeId: 'd', locked: true })] }];
	assert.ok(!messages(checkSheet(s, ocCtx)).some((m) => /you can start with/.test(m)), 'a locked fourth skill is fine');
	const approved = structuredClone(s);
	s.systems[0].skills[3].locked = false;
	const issues = checkSheet(s, { ...ocCtx, isEvolution: true, approvedSheet: approved });
	assert.ok(messages(issues, 'error').some((m) => /unlock “D” on the skill tree/.test(m)), messages(issues).join('\n'));
});

test('one canon ability per series at a time', () => {
	const s = goodSheet();
	const claims = new Map([
		['e', { name: 'Explosion', usedSlots: 0, maxUsers: 3, universe: 'my-hero-academia', claimType: 'ability' }],
		['h', { name: 'Hellflame', usedSlots: 0, maxUsers: 3, universe: 'my-hero-academia', claimType: 'ability' }],
	]);
	const errors = (ids: string[]) => messages(checkSheet(s, { ...ocCtx, claims, requestedClaims: ids }), 'error');
	assert.ok(errors(['e', 'h']).some((m) => /Only one canon ability per series/.test(m)));
	assert.ok(!errors(['e']).some((m) => /Only one canon ability/.test(m)));
});

test('JJK Barrier Techniques are locked for a new character unless unlocked', () => {
	const s = goodSheet();
	s.systems = [{ key: 'j', system: 'jujutsu-kaisen', fields: { start: 'Cursed Energy Utilization only', ceClass: 'Common', ceAmount: 10, barrierTechniques: 'Curtain' }, description: '', skills: [], rollProofs: {} }];
	const locked = (ctx: object = {}) => messages(checkSheet(s, { ...ocCtx, ...ctx }), 'error').some((m) => /Barrier Techniques are locked/.test(m));
	assert.ok(locked(), 'locked at the start');
	assert.ok(!locked({ isEvolution: true }), 'learned with BTUP after approval');
	assert.ok(!locked({ staffOverrides: { 'card:j.barrierTechniques': { to: 'Curtain' } } }), 'staff can unlock them');
	s.traits = [{ name: 'Barrier Prodigy' } as (typeof s.traits)[number]];
	assert.ok(!locked(), 'Barrier Prodigy unlocks them');
});

test('Quirk Awakenings and Variants are locked at the start and checked against their requirements after', () => {
	const quirkSheet = (fields: Record<string, string | number>) => {
		const s = goodSheet();
		s.systems = [{ key: 'q', system: 'quirk', fields: { name: 'Q', type: 'Emitter', power: 'Little', range: 'Physical', ...fields }, description: '', skills: [], rollProofs: {} }];
		return s;
	};
	const issues = (fields: Record<string, string | number>, ctx: object = {}, level?: Issue['level']) => messages(checkSheet(quirkSheet(fields), { ...ocCtx, ...ctx }), level);
	assert.ok(issues({ awakenings: 1 }, {}, 'error').some((m) => /Awakening is locked/.test(m)), 'locked for a new character');
	assert.ok(!issues({}, {}, 'error').some((m) => /locked/.test(m)), 'nothing to flag at the start');
	assert.ok(!issues({ awakenings: 1 }, { staffOverrides: { 'card:q.awakenings': { to: 1 } } }, 'error').some((m) => /Awakening/.test(m)), 'staff can unlock it');

	const approvedSheet = quirkSheet({});
	assert.ok(issues({ awakenings: 1, upgradePoints: 40 }, { isEvolution: true, approvedSheet }, 'error').some((m) => /Awakening needs 90 QUP stored/.test(m)), 'needs 90 QUP');
	assert.ok(issues({ awakenings: 1, upgradePoints: 95 }, { isEvolution: true, approvedSheet }, 'permission').some((m) => /Awakening changed; staff confirm/.test(m)), 'staff confirm the event');

	// A Variant needs Great Potential, maxed power and 50 QUP; its power level needs the Variant.
	assert.ok(issues({ variant: 'Plus', upgradePoints: 60, power: 'Average' }, { isEvolution: true, approvedSheet }, 'error').some((m) => /Great Potential or higher/.test(m)));
	assert.ok(issues({ power: 'Maximum Variant', variant: 'Plus' }, { isEvolution: true, approvedSheet: quirkSheet({ variant: 'Plus' }) }, 'error').some((m) => /needs the Maximum Variant/.test(m)));
});

test('an Awakening from a Spontaneous Evolution roll skips the 90 QUP requirement', () => {
	const s = goodSheet();
	const card = (fields: Record<string, string | number>) => [{ key: 'q', system: 'quirk', fields: { name: 'Q', type: 'Emitter', power: 'Little', range: 'Physical', ...fields }, description: '', skills: [], rollProofs: {} }];
	const approvedSheet = { ...goodSheet(), systems: card({}) };
	s.systems = card({ awakenings: 1, rolledAwakenings: 1, upgradePoints: 0 });
	const errors = messages(checkSheet(s, { ...ocCtx, isEvolution: true, approvedSheet }), 'error');
	assert.ok(!errors.some((m) => /Awakening needs/.test(m)), errors.join('\n'));
});

test('Abilities: Overclocking is locked for a new character and needs 100 AUP after approval', () => {
	const card = (fields: Record<string, string | number>) => [{ key: 'a', system: 'abilities', fields: { name: 'A', classes: ['Generation'], power: 'Puny', range: 'Physical', ...fields }, description: '', skills: [], rollProofs: {} }];
	const s = goodSheet();
	s.systems = card({ overclockSkills: 'Burst' }) as typeof s.systems;
	assert.ok(messages(checkSheet(s, ocCtx), 'error').some((m) => /Overclocking is locked/.test(m)));
	const approvedSheet = { ...goodSheet(), systems: card({}) as typeof s.systems };
	assert.ok(messages(checkSheet(s, { ...ocCtx, isEvolution: true, approvedSheet }), 'error').some((m) => /Overclocking needs 100 AUP to unlock/.test(m)));
	s.systems = card({ overclockSkills: 'Burst', upgradePoints: 120 }) as typeof s.systems;
	assert.ok(messages(checkSheet(s, { ...ocCtx, isEvolution: true, approvedSheet }), 'permission').some((m) => /Overclocking changed/.test(m)));
});

test('Chainsaw Man: Fear Points after approval, spent within what was earned, Metamorphosis one class at a time', () => {
	const s = goodSheet();
	const devil = (fields: Record<string, unknown>) => [{ key: 'd', system: 'chainsaw-man', fields: { path: 'Devil', devilClass: 'Mundane', concept: 'Spiders', ...fields }, description: '', skills: [], rollProofs: {} }];
	s.systems = devil({ fearPoints: 20, tankUpgrades: 1 });
	assert.match(messages(checkSheet(s, ocCtx), 'error').join(), /Fear Points and their upgrades come after approval/);

	const approved = goodSheet();
	approved.systems = devil({ fearPoints: 10 });
	const evo = { ...ocCtx, isEvolution: true, approvedSheet: approved };
	s.systems = devil({ fearPoints: 30, tankUpgrades: 3 });
	assert.match(messages(checkSheet(s, evo), 'error').join(), /40 FP spent on upgrades, but only 30 FP earned/);
	s.systems = devil({ fearPoints: 40, tankUpgrades: 3, devilClass: 'Rational' });
	const perms = messages(checkSheet(s, evo), 'permission').join(' | ');
	assert.match(perms, /\+30 Fear Points earned/);
	assert.match(perms, /Metamorphosis to Rational/);
	s.systems = devil({ fearPoints: 10, devilClass: 'Primal' });
	assert.match(messages(checkSheet(s, evo), 'error').join(), /one class at a time/);
	s.systems = devil({ path: 'Fiend', devilClass: 'Rational' });
	approved.systems = devil({ path: 'Fiend' });
	assert.match(messages(checkSheet(s, evo), 'error').join(), /only Devils can Metamorphose/);
});

test('Fire Force: power caps, Techniques after approval, Tephrosis only gets worse', () => {
	const s = goodSheet();
	const fire = (fields: Record<string, unknown>) => [{ key: 'f', system: 'fire-force', fields: { generation: 'Third', theme: 'Sun', ...fields }, description: '', skills: [], rollProofs: {} }];
	s.systems = fire({ power: '4', oxygenTank: '3', efficiency: '1', absorption: '1' });
	assert.deepEqual(messages(checkSheet(s, ocCtx), 'error'), []);
	s.systems = fire({ techniques: ['Breath of Life'] });
	assert.match(messages(checkSheet(s, ocCtx), 'error').join(), /taught in RP/);
	s.systems = fire({ adollaBurst: 'Yes' });
	assert.match(messages(checkSheet(s, ocCtx), 'error').join(), /Adolla Burst is locked/);

	const approved = goodSheet();
	approved.systems = fire({ power: '15', techniques: ['Breath of Life'], breathLevel: '1', tephrosis: 'Charring' });
	const evo = { ...ocCtx, isEvolution: true, approvedSheet: approved };
	s.systems = fire({ power: '16', techniques: ['Breath of Life', 'Press of Death'], breathLevel: '3', tephrosis: 'Initial Overheat' });
	const errors = messages(checkSheet(s, evo), 'error').join(' | ');
	assert.match(errors, /past Level 15 needs an Adolla Burst/);
	assert.match(errors, /can’t be stopped or cured/);
	const perms = messages(checkSheet(s, evo), 'permission').join(' | ');
	assert.match(perms, /learned Press of Death/);
	assert.match(perms, /Breath of Life Level 3 \(50 TGUP\)/);
	s.systems = fire({ tephrosis: 'Adaptation' });
	assert.match(messages(checkSheet(s, evo), 'error').join(), /needs the Body Of Adaptation trait/);
});

test('Tokyo Ghoul: GEP after approval, Kakuja needs M-Rc, One-Eyed starts with permission, Quinx only in RP', () => {
	const s = goodSheet();
	Object.assign(s.stats, { strength: '4C', speed: '4C', defense: '4C', stamina: '4C' });
	const tg = (fields: Record<string, unknown>) => [{ key: 't', system: 'tokyo-ghoul', fields: { path: 'Ghoul', kagune: 'Ukaku', ...fields }, description: '', skills: [], rollProofs: {} }];
	s.systems = tg({});
	assert.deepEqual(messages(checkSheet(s, ocCtx), 'error'), []);
	s.systems = tg({ gep: 10, tankUpgrades: 1 });
	assert.match(messages(checkSheet(s, ocCtx), 'error').join(), /GEP, Rc Tank upgrades and M-Rc come after approval/);
	s.systems = tg({ oneEyed: 'Yes' });
	assert.match(messages(checkSheet(s, ocCtx), 'permission').join(), /starting with One-Eyed Ghoul needs permission/);
	s.systems = [{ ...tg({})[0], fields: { path: 'Human (Quinque user)', quinx: 'Yes', kagune: 'Bikaku' } }];
	assert.match(messages(checkSheet(s, ocCtx), 'error').join(), /Quinx is locked/);

	const approved = goodSheet();
	approved.systems = tg({ gep: 5 });
	const evo = { ...ocCtx, isEvolution: true, approvedSheet: approved };
	s.systems = tg({ gep: 20, tankUpgrades: 4 });
	assert.match(messages(checkSheet(s, evo), 'error').join(), /25 GEP spent on the Rc Tank, but only 20 GEP earned/);
	s.systems = tg({ gep: 25, tankUpgrades: 4, mutatedRc: 300, kakuja: 'Incomplete Kakuja' });
	const errors = messages(checkSheet(s, evo), 'error').join(' | ');
	assert.match(errors, /Incomplete Kakuja needs 500 M-Rc/);
	const perms = messages(checkSheet(s, evo), 'permission').join(' | ');
	assert.match(perms, /\+20 GEP earned/);
	assert.match(perms, /Rc Tank upgrade 4/);
	assert.match(perms, /\+300 M-Rc/);
});

test('inFAMOUS: CTP on any stat but Tank, items and Karma after approval, Karma Bomb needs 5 Core Relays', async () => {
	const { ctpSpent, conduitFromOld, karmaRank, powerBeats } = await import('./conduits.ts');
	const s = goodSheet();
	const cf = (fields: Record<string, unknown>) => [{ key: 'c', system: 'infamous', fields: { class: 'Elemental', element: 'Neon', ...fields }, description: '', skills: [], rollProofs: {} }];
	s.systems = cf({ power: '1', drain: '4', heal: '5.5' });
	assert.equal(ctpSpent(s.systems[0].fields), 4);
	assert.deepEqual(messages(checkSheet(s, ocCtx), 'error'), []);
	assert.doesNotMatch(messages(checkSheet(s, ocCtx), 'warning').join(), /Conduit Tier Points/);
	s.systems = cf({ power: '2', drain: '4' });
	assert.match(messages(checkSheet(s, ocCtx), 'error').join(), /5 Conduit Tier Points spent, but you start with 4\. Ask for a stat override/);
	s.systems = cf({ tank: '1' });
	assert.match(messages(checkSheet(s, ocCtx), 'error').join(), /Elemental Tank starts at/);
	s.systems = cf({ blastShards: 2, karmaPoints: 10 });
	assert.match(messages(checkSheet(s, ocCtx), 'error').join(), /evolution items and Karma come after approval/);
	s.systems = cf({ karmaBomb: 'A neon nova.' });
	assert.match(messages(checkSheet(s, ocCtx), 'error').join(), /Karma Bomb is locked/);

	const approved = goodSheet();
	approved.systems = cf({ coreRelays: 2, karma: 'Good', karmaPoints: 50 });
	const evo = { ...ocCtx, isEvolution: true, approvedSheet: approved };
	s.systems = cf({ coreRelays: 4, blastShards: 3, karma: 'Good', karmaPoints: 120, tank: '1', karmaBomb: 'A neon nova.' });
	const perms = messages(checkSheet(s, evo), 'permission').join(' | ');
	assert.match(perms, /\+2 Core Relays; staff check the Arc Rolls/);
	assert.match(perms, /\+3 Blast Shards/);
	assert.match(perms, /Karma \+70/);
	assert.match(perms, /Elemental Tank upgraded/);
	assert.match(messages(checkSheet(s, evo), 'error').join(), /Karma Bomb needs 5 Core Relays absorbed first/);
	s.systems = cf({ coreRelays: 5, karma: 'Good', karmaPoints: 50, karmaBomb: 'A neon nova.', karmicStreak: 40 });
	assert.doesNotMatch(messages(checkSheet(s, evo), 'error').join(), /Karma Bomb|Karmic Streak/);

	// Psychics start at Phase 5; Phase X is Permission Based.
	s.systems = [{ key: 'p', system: 'infamous', fields: { class: 'Psychic', psychicPhase: '4' }, description: '', skills: [], rollProofs: {} }];
	assert.match(messages(checkSheet(s, ocCtx), 'error').join(), /Psychic Phase starts at/);

	assert.equal(powerBeats('0', false), 'Tier 2 up to C');
	assert.equal(powerBeats('7.7', true), 'all of Tier 10');
	assert.equal(powerBeats('X', false), 'all of Tier 14');
	assert.deepEqual(karmaRank({ karma: 'Evil', karmaPoints: 240 }), { points: 240, ranks: ['Thug', 'Criminal', 'Bio-Terrorist', 'Most Wanted', 'Infamous'], reached: 2, next: 390, name: 'Criminal' });
	assert.deepEqual(conduitFromOld({ class: 'Energy', power: 2, tank: 1 }), { class: 'Energy', power: '1', energyTank: '1' });
});

test('inFAMOUS: Elemental and Energy Conduits get their default moves; Psychics get none', async () => {
	const { conduitMoves } = await import('./conduits.ts');
	assert.deepEqual(conduitMoves({ class: 'Elemental', element: 'neon', tank: '2' }).map((m) => [m.name, m.type, m.cost]), [
		['Elemental Blast', 'standard', '30 EP'],
		['Elemental Dash', 'standard', '15-turn cooldown'],
		['Elemental Special', 'ultimate', '1 Special'],
	]);
	assert.match(conduitMoves({ class: 'Elemental', element: 'neon', tank: '2' })[2].effect, /You have 4/);
	assert.deepEqual(conduitMoves({ class: 'Energy' }).map((m) => [m.name, m.cost]), [['Energy Blast', '50 EP'], ['Energy Special', '1 Special']]);
	assert.deepEqual(conduitMoves({ class: 'Psychic' }), []);
});

test('a canon Quirk keeps its canon class and Quirk Factor', async () => {
	const { canonQuirk } = await import('./canonQuirks.ts');
	assert.deepEqual(canonQuirk('Half-Cold Half-Hot'), canonQuirk('Half Hot Half Cold'));
	assert.equal(canonQuirk('Creation')?.class, 'Emitter');
	const s = goodSheet();
	const claims = new Map([['c', { name: 'Creation', usedSlots: 0, maxUsers: 3, universe: 'my-hero-academia', claimType: 'ability', category: 'Standard' }]]);
	s.systems = [{ key: 'q', system: 'quirk', fields: { type: 'Mutation', factor: 'Hands', power: 'Little', range: 'Physical' }, description: '', skills: [], rollProofs: {} }];
	const errors = messages(checkSheet(s, { ...ocCtx, claims, requestedClaims: ['c'] }), 'error').join(' | ');
	assert.match(errors, /Creation is a canon Emitter Quirk/);
	assert.match(errors, /Creation’s Quirk Factor is Skin \(uses body lipids\)/);
	s.systems[0].fields = { ...s.systems[0].fields, type: 'Emitter', factor: 'Skin (uses body lipids)' };
	assert.doesNotMatch(messages(checkSheet(s, { ...ocCtx, claims, requestedClaims: ['c'] }), 'error').join(), /Creation/);
});

test('Awakenings are a log: old counts convert, and each entry says what it gave', async () => {
	const { awakeningsFromOld, withAwakenings, newAwakening } = await import('./awakenings.ts');
	const old = awakeningsFromOld({ awakenings: 2, rolledAwakenings: 1, awakeningGains: 'Higher power' });
	assert.equal((old.awakeningLog as unknown as { how: string }[]).map((e) => e.how).join(), 'Event,Spontaneous Evolution');
	assert.equal(old.awakenings, 2);
	assert.equal(old.rolledAwakenings, 1);
	assert.ok(!('awakeningGains' in old));
	const fields = withAwakenings({ type: 'Emitter', power: 'Little', range: 'Physical', upgradePoints: 95 }, [newAwakening('Event')]);
	const s = goodSheet();
	s.systems = [{ key: 'q', system: 'quirk', fields, description: '', skills: [], rollProofs: {} }];
	const errors = messages(checkSheet(s, { ...ocCtx, isEvolution: true, approvedSheet: goodSheet() }), 'error').join(' | ');
	assert.match(errors, /Awakening #1: say what it gave/);
	assert.match(errors, /Awakening #1: describe the event/);
});

test('Quirk rolls: one Instability roll per RP, Spontaneous Evolution only after 3 unstable RPs, chances as percentages', async () => {
	const { quirkCooldown, chance, RP_MS } = await import('./evolutionRolls.ts');
	const t0 = Date.parse('2026-11-09T12:00:00Z');
	const r = (id: number, kind: 'quirk_instability' | 'quirk_evolution', result: string, at: number) => ({ id, card_key: 'q', kind, sides: 1000, roll: 1, result, created_at: new Date(at).toISOString() });
	const stable = [r(1, 'quirk_instability', 'stable', t0)];
	assert.equal(quirkCooldown(stable, t0 + RP_MS / 2).readyAt, t0 + RP_MS);
	assert.equal(quirkCooldown(stable, t0 + RP_MS).readyAt, null);
	const unstable = [r(1, 'quirk_instability', 'unstable', t0)];
	assert.deepEqual(quirkCooldown(unstable, t0 + 2.5 * RP_MS), { readyAt: t0 + 3 * RP_MS, rpsDone: 2 });
	assert.deepEqual(quirkCooldown(unstable, t0 + 3 * RP_MS), { readyAt: null, rpsDone: 3 });
	assert.equal(chance(500, 1000, 1000), '50.1%');
	assert.equal(chance(1001, 5000, 10000), '40%');
	assert.equal(chance(8000, 9949, 10000), '19.5%');
});

test('Fire Force: a Pillar Ignition brings its Adolla Burst and theme, and the claim is its permission', async () => {
	const s = goodSheet();
	const claims = new Map([['p', { name: 'Excalibur', usedSlots: 0, maxUsers: 1, universe: 'fire-force', claimType: 'ability', category: 'Pillar' }]]);
	const ctx = { ...ocCtx, claims, requestedClaims: ['p'] };
	s.systems = [{ key: 'f', system: 'fire-force', fields: { generation: 'Third', theme: 'Light' }, description: '', skills: [], rollProofs: {} }];
	assert.match(messages(checkSheet(s, ctx), 'error').join(), /Excalibur is a Pillar’s Ignition/);
	assert.match(messages(checkSheet(s, ctx), 'error').join(), /Excalibur follows its canon theme/);
	const { canonIgnition } = await import('./canonIgnitions.ts');
	s.systems[0].fields = { ...s.systems[0].fields, ...canonIgnition({ name: 'Excalibur', category: 'Pillar' }), pillar: 'Pride' };
	const errors = messages(checkSheet(s, ctx), 'error').join(' | ');
	assert.doesNotMatch(errors, /Excalibur|Adolla Burst is locked/);
});

test('Fire Force: techniques are a log of who taught them; old cards convert', async () => {
	const { techniquesFromOld, withTechniques } = await import('./fireforceLogs.ts');
	const old = techniquesFromOld({ techniques: ['Breath of Life', 'Crimson Technique'], techniqueTeachers: 'Captain Obi', crimson: [{ name: 'Flash', inventor: 'Joker' }] });
	assert.deepEqual(old.techniques, ['Breath of Life', 'Crimson Technique']);
	assert.deepEqual(old.techniqueLog, [{ technique: 'Breath of Life', teacher: 'Captain Obi', date: '' }]);
	assert.ok(!('techniqueTeachers' in old));
	const fields = withTechniques({ generation: 'Third', theme: 'Sun', power: '15' }, [{ technique: 'Press of Death', teacher: '', date: '2026-11-09' }]);
	assert.deepEqual(fields.techniques, ['Press of Death']);
	const approved = goodSheet();
	approved.systems = [{ key: 'f', system: 'fire-force', fields: { generation: 'Third', theme: 'Sun', power: '15' }, description: '', skills: [], rollProofs: {} }];
	const s = goodSheet();
	s.systems = [{ key: 'f', system: 'fire-force', fields, description: '', skills: [], rollProofs: {} }];
	const evo = { ...ocCtx, isEvolution: true, approvedSheet: approved };
	assert.match(messages(checkSheet(s, evo), 'error').join(), /say who taught you Press of Death/);
	s.systems[0].fields = withTechniques(fields, [{ technique: 'Press of Death', teacher: 'Benimaru', date: '2026-11-09' }]);
	assert.match(messages(checkSheet(s, evo), 'permission').join(), /learned Press of Death from Benimaru/);
});

test('Fire Force: peeks are 60% with 2 a Link (a day), and Tephrosis moves on by itself', async () => {
	const { peekCooldown, tephrosisStage } = await import('./fireforceLogs.ts');
	const { chance, evolutionResult, RP_MS } = await import('./evolutionRolls.ts');
	assert.equal(chance(5, 10, 10), '60%');
	assert.equal(evolutionResult('adolla_peek', 5), 'seen');
	assert.equal(evolutionResult('adolla_peek', 4), 'unseen');
	const t0 = Date.parse('2026-11-09T12:00:00Z');
	const peek = (id: number, at: number) => ({ id, card_key: 'f', kind: 'adolla_peek' as const, sides: 10, roll: 3, result: 'unseen', created_at: new Date(at).toISOString() });
	assert.equal(peekCooldown([peek(1, t0)], t0 + 1000), null);
	assert.equal(peekCooldown([peek(1, t0), peek(2, t0 + 5000)], t0 + 6000), t0 + RP_MS);
	assert.equal(peekCooldown([peek(1, t0), peek(2, t0 + 5000)], t0 + RP_MS + 1), null);
	const since = new Date(t0).toISOString();
	assert.equal(tephrosisStage(since, t0 + RP_MS)?.id, 'Initial Overheat');
	assert.equal(tephrosisStage(since, t0 + 2 * RP_MS)?.id, 'Charring');
	assert.equal(tephrosisStage(since, t0 + 2 * RP_MS)?.nextAt, t0 + 7 * RP_MS);
	assert.equal(tephrosisStage(since, t0 + 7 * RP_MS)?.id, 'End Stage');
	assert.equal(tephrosisStage(undefined), null);
});

test('JJK: Barrier Techniques are a list of cards; an old text box becomes one entry', async () => {
	const { barriersFromOld, barrierUsed, systemById } = await import('./systems.ts');
	assert.deepEqual(barriersFromOld({ barrierTechniques: 'Curtain, Simple Domain' }).barrierTechniques, [{ kind: '', name: '', notes: 'Curtain, Simple Domain' }]);
	assert.deepEqual(barriersFromOld({ barrierTechniques: '  ' }).barrierTechniques, []);
	const field = systemById.get('jujutsu-kaisen')!.fields.find((x) => x.key === 'barrierTechniques')!;
	assert.equal(barrierUsed(field, []), false, 'an empty list is not a locked value');
	assert.equal(barrierUsed(field, [{ kind: 'Curtain', name: '', notes: '' }]), true);
});

test('Dropping a stat override: back to the start, God goes, overspent points come off', async () => {
	const { dropStatOverride } = await import('./rules.ts');
	const s = goodSheet();
	const entry = { key: 'a', system: 'abilities', fields: { classes: ['Manipulation', 'God'], power: 'Average', range: 'Long' }, description: '', skills: [], rollProofs: {}, statOverride: { reason: 'x' } };
	s.systems = [entry];
	dropStatOverride(s, entry);
	assert.equal(entry.statOverride, undefined);
	assert.deepEqual(entry.fields.classes, ['Manipulation']);
	// 8 + 3 Ability Tier Points spent of 4: power comes back to the start, and then Long range fits.
	assert.equal(entry.fields.power, 'No Power');
	assert.equal(entry.fields.range, 'Long');
	// Within the start, nothing changes.
	const ok = { key: 'b', system: 'abilities', fields: { classes: ['Generation'], power: 'Puny', range: 'Close' }, description: '', skills: [], rollProofs: {}, statOverride: { reason: 'x' } };
	s.systems = [ok];
	dropStatOverride(s, ok);
	assert.deepEqual(ok.fields, { classes: ['Generation'], power: 'Puny', range: 'Close' });
});

test('Oculars: a counted spot, the eye named and described, and a full board is closed', async () => {
	const { ocularFromOld } = await import('./systems.ts');
	const s = goodSheet();
	s.systems = [{ key: 'j', system: 'jujutsu-kaisen', fields: { start: 'Cursed Technique', ceClass: 'Common', ceAmount: 10 }, description: '', skills: [], rollProofs: {} }];
	const spot = (used: number) => new Map([['o', { name: 'Ocular Jujutsu Organ', usedSlots: used, maxUsers: 7, universe: 'jujutsu-kaisen', claimType: 'ocular', category: 'Ocular' }]]);
	const issues = (used: number) => checkSheet(s, { ...ocCtx, claims: spot(used), requestedClaims: ['o'] });
	assert.ok(issues(6).some((i) => i.level === 'error' && i.message === 'Oculars: name your Ocular.'));
	s.systems[0].fields = { ...s.systems[0].fields, ocular: 'Clear Sky', ocularAbility: 'Sees through illusions' };
	assert.ok(issues(6).some((i) => i.level === 'permission' && i.message.includes('Clear Sky') && i.card === 'j'));
	assert.ok(!issues(6).some((i) => /canon ability per series/.test(i.message)), 'an Ocular is not a canon ability');
	assert.ok(issues(7).some((i) => i.message.startsWith('All Ocular Spots are taken')));
	// Old cards asked for one as a Permission Based start.
	const old = ocularFromOld({ extras: ['Cursed Energy Property', 'Ocular Jujutsu Organ'], ocular: 'Clear Sky', OcularJujutsuOrganDetails: 'Sees through illusions' });
	assert.deepEqual(old, { extras: ['Cursed Energy Property'], ocular: 'Clear Sky', ocularAbility: 'Sees through illusions' });
});

test('Stat override: asking for Barrier Techniques and a Heavenly Restriction', async () => {
	const { denyStatOverride } = await import('./rules.ts');
	const s = goodSheet();
	s.systems = [jjk({ barrierTechniques: [{ kind: 'Simple Domain', name: '', notes: '' }], simpleDomainGrade: 'Grade 4' })];
	s.prioritySystem = 'j';
	const barrier = () => checkSheet(s, ocCtx).filter((i) => i.message.includes('Barrier Techniques'));
	assert.ok(barrier().some((i) => i.level === 'error' && i.message.includes('are locked')));
	s.systems[0].statOverride = { reason: 'x', barrier: '' };
	assert.ok(barrier().some((i) => i.level === 'error' && i.message.includes('say why')));
	s.systems[0].statOverride = { reason: 'x', barrier: 'Trained by a Barrier master' };
	assert.ok(barrier().some((i) => i.level === 'permission' && i.message.includes('Trained by a Barrier master')));
	assert.ok(!barrier().some((i) => i.level === 'error'));
	// Heavenly Restriction asked for in the override instead of granted.
	s.systems = [jjk({ heavenlyRestriction: 'Cursed Energy', start: 'Cursed Energy Utilization only' })];
	s.stats = { ...s.stats, phase: 2, strength: '13F', speed: '13F', defense: '13F', stamina: '13F', intelligence: 'Gifted' };
	const hr = () => checkSheet(s, { ...ocCtx, heavenlyGrant: null }).filter((i) => i.message.includes('Heavenly') || i.message.includes('Cursed Energy Restriction'));
	assert.ok(hr().some((i) => i.level === 'error' && i.message.includes('isn’t granted')));
	s.systems[0].statOverride = { reason: 'x', heavenly: '' };
	assert.ok(hr().some((i) => i.level === 'error' && i.message.includes('say why')));
	s.systems[0].statOverride = { reason: 'x', heavenly: 'Born without CE in my story' };
	assert.ok(hr().some((i) => i.level === 'permission' && i.message.includes('Born without CE')), hr().map((i) => i.message).join('\n'));
	assert.ok(!hr().some((i) => i.level === 'error'), hr().map((i) => i.message).join('\n'));
	// Denied: the restriction goes too.
	assert.equal(denyStatOverride(s, 'j').systems[0].fields.heavenlyRestriction, 'None');
});

test('Traits change a start: the One Eyed Ghoul Combo, Bio-King, Quirk Prodigy, Stand Prodigy', async () => {
	const { traitEffectsFor } = await import('./rules.ts');
	const { potentialState, potentialsFor, potentialCtxOf } = await import('./potentials.ts');
	const s = goodSheet();
	s.systems = [{ key: 'g', system: 'tokyo-ghoul', fields: { oneEyed: 'Yes', oneEyedHow: 'Born one' }, description: '', skills: [], rollProofs: {} }];
	s.prioritySystem = 'g';
	const oneEyed = (combos?: string[]) => checkSheet(s, { ...ocCtx, combos }).filter((i) => i.message.includes('One-Eyed'));
	assert.ok(oneEyed().some((i) => i.level === 'permission' && i.message.includes('needs permission')));
	assert.deepEqual(oneEyed(['One Eyed Ghoul']), [], 'the Combo trait lets them start as one');
	const p = potentialsFor('tokyo-ghoul').find((x) => x.id === 'oneEyed')!;
	assert.match(potentialState(p, s.systems[0], { ...potentialCtxOf(s, ['One Eyed Ghoul']) }).reason, /Combo trait/);
	assert.ok(traitEffectsFor(s, 'tokyo-ghoul', ['One Eyed Ghoul']).some((t) => t.effect === 'Start as a One-Eyed Ghoul'));
	// Options only a trait opens.
	s.systems = [{ key: 'a', system: 'abilities', fields: { classes: ['Generation'], power: 'Colossal', range: 'Physical' }, description: '', skills: [], rollProofs: {} }];
	s.prioritySystem = 'a';
	const bio = () => messages(checkSheet(s, { ...ocCtx, isEvolution: true }), 'error').filter((m) => m.includes('Bio-King'));
	assert.equal(bio().length, 1);
	s.traits = [{ name: 'Bio-King' }] as Sheet['traits'];
	assert.equal(bio().length, 0);
	assert.ok(traitEffectsFor(s, 'abilities').some((t) => t.trait === 'Bio-King' && t.effect.includes('Colossal, Peak, Apex')));
	s.traits = [{ name: 'Stand Prodigy' }] as Sheet['traits'];
	assert.ok(traitEffectsFor(s, 'jojo').some((t) => t.effect.startsWith('+5')));
	s.traits = [{ name: 'Quirk Prodigy' }] as Sheet['traits'];
	assert.ok(traitEffectsFor(s, 'quirk').some((t) => t.effect.includes('Decent, Great')));
});

test('JoJo: Esoteric Ability awakens with Stand Awakening or Stand Prodigy; Spin starts only with Spinning Soul; canon Stands keep their stats', async () => {
	const { potentialState, potentialsFor, potentialCtxOf } = await import('./potentials.ts');
	const { canonStand, canonStandFields } = await import('./canonStands.ts');
	const s = goodSheet();
	const card = { key: 'jo', system: 'jojo', fields: { hasStand: 'Yes', standName: 'Silent Echo', standDestructivePower: 'C', standSpeed: 'C', standRange: 'C', standDurability: 'C', standPrecision: 'D', standDevelopmentalPotential: 'E', esotericAbility: 'Freezes sound' }, description: '', skills: [], rollProofs: {} } as Sheet['systems'][number];
	s.systems = [card];
	s.prioritySystem = 'jo';
	const esoteric = () => checkSheet(s, ocCtx).filter((i) => i.message.includes('Esoteric Ability'));
	assert.ok(esoteric().some((i) => i.level === 'error' && i.message.includes('locked')));
	const p = potentialsFor('jojo').find((x) => x.id === 'esoteric')!;
	assert.equal(potentialState(p, card, potentialCtxOf(s)).open, false);
	s.traits = [{ name: 'Stand Prodigy' }] as Sheet['traits'];
	assert.deepEqual(esoteric(), []);
	assert.match(potentialState(p, card, potentialCtxOf(s)).reason, /Stand Prodigy/);
	// After approval, a full Stand Awakening opens it.
	s.traits = [];
	assert.equal(potentialState(p, { ...card, fields: { ...card.fields, standAwakening: 180 } }, { ...potentialCtxOf(s), isEvolution: true }).open, true);
	// Spin: only Spinning Soul starts with it; anyone can learn it later.
	card.fields = { ...card.fields, esotericAbility: '', spin: 'Yes' };
	const spin = () => checkSheet(s, ocCtx).filter((i) => i.message.includes('Spin'));
	assert.ok(spin().some((i) => i.level === 'error' && i.message.includes('Spinning Soul')), spin().map((i) => i.message).join('\n'));
	s.traits = [{ name: 'Spinning Soul' }] as Sheet['traits'];
	assert.ok(!spin().some((i) => i.level === 'error' || i.level === 'permission'), spin().map((i) => i.message).join('\n'));
	const sp = potentialsFor('jojo').find((x) => x.id === 'spin')!;
	assert.ok(!potentialState(sp, card, { ...potentialCtxOf({ ...s, traits: [] }), isEvolution: true }).requirements.some((r) => r.label.includes('Spinning Soul')));
	// Canon Stands: stats from the wiki, and Gold Experience under its board name.
	assert.deepEqual(canonStand('Star Platinum')!.stats, ['A', 'A', 'C', 'A', 'A', 'A']);
	assert.equal(canonStand('Golden Experience')?.user, 'Giorno Giovanna');
	assert.equal(canonStandFields('Mandom').standDestructivePower, 'None');
	s.traits = [];
	card.fields = { hasStand: 'Yes', standName: 'Star Platinum', canonStand: 'Star Platinum', ...canonStandFields('Star Platinum') };
	const claims = new Map([['sp', { name: 'Star Platinum', usedSlots: 0, maxUsers: 1, universe: 'jojo', claimType: 'ability' }]]);
	const stand = (requested: string[]) => messages(checkSheet(s, { ...ocCtx, claims, requestedClaims: requested }), 'error').filter((m) => m.includes('Star Platinum') || m.includes('Stand Points'));
	assert.deepEqual(stand(['sp']), [], 'canon stats skip the 15 starting points');
	assert.ok(stand([]).some((m) => m.includes('isn’t claimed')));
	card.fields.standSpeed = 'E';
	assert.ok(stand(['sp']).some((m) => m.includes('canon stats')));
});

test('inFAMOUS: canon Conduits keep their class; Psychics track who is under their influence', async () => {
	const { puppetRolls } = await import('./conduits.ts');
	const s = goodSheet();
	s.systems = [{ key: 'i', system: 'infamous', fields: { class: 'Elemental', element: 'Fire' }, description: '', skills: [], rollProofs: {} }];
	s.prioritySystem = 'i';
	const claims = new Map([['v', { name: 'Video', usedSlots: 0, maxUsers: 1, universe: 'infamous', claimType: 'ability' }]]);
	const canon = () => messages(checkSheet(s, { ...ocCtx, claims, requestedClaims: ['v'] }), 'error').filter((m) => m.includes('Video'));
	assert.ok(canon().some((m) => m.includes('canon Elemental Conduit (Video)')));
	s.systems[0].fields.element = 'Video';
	assert.deepEqual(canon(), []);
	// Psychics: puppets come after approval, and Bio-Conduits only fall to Phase X.
	const puppet = { name: 'Marcus', kind: 'OC', target: 'Human or other', how: 'contact', commands: '3', rps: '1' };
	s.systems[0].fields = { class: 'Psychic', psychicPhase: '5', puppets: [puppet] as unknown as string[] };
	const errs = (isEvolution = false) => messages(checkSheet(s, { ...ocCtx, isEvolution }), 'error').filter((m) => m.includes('influence') || m.includes('Phase X'));
	assert.ok(errs().some((m) => m.includes('after approval')));
	assert.deepEqual(errs(true), []);
	s.systems[0].fields.puppets = [{ ...puppet, target: 'Bio-Enhanced Conduit' }] as unknown as string[];
	assert.ok(errs(true).some((m) => m.includes('Phase X')));
	s.systems[0].fields.psychicPhase = 'X';
	assert.deepEqual(errs(true), []);
	// Phase 5: a resist roll every 3 commands, a break-free roll every RP; Phase 2 victims can't.
	assert.equal(puppetRolls(puppet, '5').resist, '1d60, 30+');
	assert.equal(puppetRolls(puppet, '5').breakFree, '1d100, 50+');
	assert.equal(puppetRolls({ ...puppet, commands: '4' }, '4').nextResist, 2);
	assert.equal(puppetRolls(puppet, '2').resist, null);
});
