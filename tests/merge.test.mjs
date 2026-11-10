// Run with: node tests/merge.test.mjs
import assert from 'node:assert/strict';
import { clean, cleanPerson, personId, wins } from '../js/db.js';

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

// only real photo types are kept (an SVG data URL is dropped)
assert.equal(clean({ id: 'i', image: 'data:image/svg+xml;base64,PHN2Zz4=' }).image, '');
assert.equal(clean({ id: 'i', image: 'data:image/webp;base64,AAAA' }).image, 'data:image/webp;base64,AAAA');

// gifts: the "for" list is rebuilt, deduplicated and capped; old wishes without it become "for me"
assert.deepEqual(clean({ id: 'g' }).for, []);
assert.deepEqual(clean({ id: 'g', for: ['p-mom', 'p-mom', 5, '', 'p-dad'] }).for, ['p-mom', 'p-dad']);
assert.equal(clean({ id: 'g', for: Array.from({ length: 50 }, (_, i) => 'p' + i) }).for.length, 20);
assert.equal(clean({ id: 'g', for: 'p-mom' }).for.length, 0);
assert.equal(clean({ id: 'g', given: true }).given, true);
assert.equal(clean({ id: 'g', given: 'yes' }).given, false);

// people: same name gives the same id on every device
assert.equal(personId('Mom'), 'p-mom');
assert.equal(personId('  Tita  Mai! '), 'p-tita-mai');
assert.equal(personId('???'), 'p-person');
assert.equal(cleanPerson({ id: 'p-mom', name: '  Mom ', deleted: 1 }).name, 'Mom');
assert.equal(cleanPerson({ id: 'p-mom', name: 'Mom', deleted: 1 }).deleted, false);
assert.equal(cleanPerson({ name: 'no id' }), null);
assert.equal(cleanPerson({ id: 'p-x', name: 'x'.repeat(100) }).name.length, 40);

console.log('merge tests passed');
