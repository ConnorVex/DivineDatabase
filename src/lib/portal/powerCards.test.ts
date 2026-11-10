import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lockText } from './powerCards.ts';

test('evolution lock wording', () => {
	assert.equal(lockText({ lockDays: 7, lockRps: 3 }), '7 days, or sooner after 3 RPs');
	assert.equal(lockText({ lockDays: 1, lockRps: 0 }), '1 day');
	assert.equal(lockText({ lockDays: 0, lockRps: 1 }), '1 RP');
	assert.equal(lockText({ lockDays: 0, lockRps: 0 }), 'no wait');
});
