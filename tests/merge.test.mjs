// Run with: node tests/merge.test.mjs
import assert from 'node:assert/strict';
import { clean, wins } from '../js/db.js';

const base = { id: 'a', name: 'Chair', price: 100, updatedAt: 10 };

// newest edit wins, older loses, new records are taken
assert.equal(wins(undefined, base), true);
assert.equal(wins({ ...base, updatedAt: 5 }, base), true);
assert.equal(wins({ ...base, updatedAt: 20 }, base), false);
assert.equal(wins({ ...base, updatedAt: 10 }, base), false);

// a delete (tombstone) survives and beats an older edit
const tomb = clean({ ...base, deleted: true, updatedAt: 30 });
assert.equal(tomb.deleted, true);
assert.equal(wins({ ...base, updatedAt: 20 }, tomb), true);

// untrusted input is rebuilt, never trusted
assert.equal(clean(null), null);
assert.equal(clean({ name: 'no id' }), null);
assert.equal(clean({ id: 'x'.repeat(65) }), null);
const bad = clean({ id: 'b', name: 5, price: -3, link: 'javascript:alert(1)', image: 'http://evil/x.png', priority: 9, granted: 'yes' });
assert.equal(bad.name, '');
assert.equal(bad.price, 0);
assert.equal(bad.link, '');
assert.equal(bad.image, '');
assert.equal(bad.priority, 2);
assert.equal(bad.granted, false);
assert.equal(clean({ id: 'c', link: 'https://shop.com/a', image: 'data:image/jpeg;base64,AAAA' }).link, 'https://shop.com/a');

console.log('merge tests passed');
