import { getAll, put, newWish, mergeAll, clean, getPeople, putPerson, mergePeople, addPerson } from './db.js';
import { createSession, createShortSession, normCode } from './sync.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };

// Build elements with textContent only, so nothing a wish contains is ever parsed as HTML.
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  e.append(...kids.filter(x => x != null && x !== false));
  return e;
}

const money = n => '₱' + Number(n || 0).toLocaleString('en-PH', Number.isInteger(n) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const hash = s => [...s].reduce((a, c) => a + c.charCodeAt(0), 0);

const st = { items: [], people: [], view: 'wall', person: '', group: '', q: '', sort: 'priority', cur: null };
const own = w => w.for.length === 0; // a wish with nobody in "Gift for" is for me
const personOf = id => st.people.find(p => p.id === id);
const sum = a => a.reduce((s, w) => s + w.price, 0);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/* ---------- toast ---------- */
let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ---------- theme ---------- */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  lsSet('wb-theme', t);
  $$('[data-theme-toggle] i').forEach(i => { i.className = 'ti ' + (t === 'dark' ? 'ti-sun' : 'ti-moon'); });
  $$('#side [data-theme-toggle] span').forEach(s => { s.textContent = t === 'dark' ? 'Light mode' : 'Dark mode'; });
}
$$('[data-theme-toggle]').forEach(b => b.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
}));

/* ---------- data and rendering ---------- */
async function refresh() {
  st.items = (await getAll()).filter(w => !w.deleted).map(w => ({ for: [], given: false, ...w }));
  st.people = (await getPeople()).filter(p => !p.deleted).sort((a, b) => a.name.localeCompare(b.name));
  if (st.person && !personOf(st.person)) st.person = '';
  render();
}

function lastText() {
  const t = Number(lsGet('wb-last'));
  if (!t) return 'Sync and backup';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'Synced just now';
  if (m < 60) return `Synced ${m} min ago`;
  if (m < 1440) return `Synced ${Math.round(m / 60)} h ago`;
  return `Synced ${Math.round(m / 1440)} d ago`;
}

function render() {
  // My own wishes and gifts for other people are counted separately.
  const mine = st.items.filter(own), gifts = st.items.filter(w => !own(w));
  const open = mine.filter(w => !w.granted), done = mine.filter(w => w.granted);
  const toBuy = gifts.filter(w => !w.granted), bought = gifts.filter(w => w.granted);

  $$('[data-total]').forEach(e => { e.textContent = money(sum(open)); });
  $$('[data-count]').forEach(e => { e.textContent = open.length; });
  $$('[data-sub]').forEach(e => { e.textContent = `${plural(open.length, 'wish', 'wishes')} · ${money(sum(done))} granted`; });
  $$('[data-gifts]').forEach(e => { e.textContent = `Gifts to buy ${money(sum(toBuy))}`; });
  $$('[data-granted-line]').forEach(e => {
    e.textContent = `${money(sum(done))} already granted` + (bought.length ? ` · ${money(sum(bought))} in gifts bought` : '');
  });
  $$('[data-last]').forEach(e => { e.textContent = lastText(); });
  $$('[data-view]').forEach(b => {
    const on = b.dataset.view === st.view;
    b.setAttribute('aria-selected', on);
    if (b.classList.contains('nv')) b.setAttribute('aria-current', on);
  });

  const groups = [...new Set(st.items.map(w => w.group).filter(Boolean))].sort();
  if (st.group && !groups.includes(st.group)) st.group = '';
  $('#group').replaceChildren(h('option', { value: '' }, 'All groups'),
    ...groups.map(g => h('option', { value: g, selected: g === st.group }, g)));
  $('#glist').replaceChildren(...groups.map(g => h('option', { value: g })));
  $('#groups').replaceChildren(...groups.map(g => h('button', {
    class: 'nv', 'aria-current': g === st.group, onclick: () => { st.group = st.group === g ? '' : g; render(); },
  }, h('i', { class: 'ti ti-tag' }), g)));

  const inPeople = st.view === 'people', person = inPeople && personOf(st.person);
  const grid = inPeople && !person;
  $('#people').hidden = !grid;
  $('#phead').hidden = !person;
  $('#tools').hidden = grid;
  $('#wall').hidden = grid;
  $('#quick .plus').setAttribute('aria-label', person ? `Add a gift for ${person.name}` : 'Add wish');
  $('#qin').placeholder = person ? `Paste a gift idea for ${person.name}` : 'Paste a link or photo';
  if (grid) { renderPeople(gifts); $('#empty').hidden = true; return; }

  const q = st.q.toLowerCase();
  const pool = person ? st.items.filter(w => w.for.includes(person.id)) : st.view === 'granted' ? st.items.filter(w => w.granted) : open;
  let list = pool
    .filter(w => !st.group || w.group === st.group)
    .filter(w => !q || [w.name, w.notes, w.group].some(x => x.toLowerCase().includes(q)));
  const by = {
    priority: (a, b) => b.priority - a.priority || b.updatedAt - a.updatedAt,
    newest: (a, b) => b.createdAt - a.createdAt,
    high: (a, b) => b.price - a.price,
    low: (a, b) => a.price - b.price,
  }[st.sort];
  list = list.sort(by);
  if (person) list = list.sort((a, b) => a.granted - b.granted); // gifts still to buy first

  if (person) {
    const mineG = pool, left = mineG.filter(w => !w.granted);
    $('#pname-h').textContent = person.name;
    $('#pmeta').textContent = `${plural(mineG.length, 'gift', 'gifts')} · ${money(sum(left))} to buy · ${mineG.filter(w => w.given).length} given`;
  }

  const wall = $('#wall');
  wall.className = 'wall' + (st.view === 'list' ? ' list' : '');
  const n = st.view === 'list' ? 1 : wallCols();
  const cols = Array.from({ length: n }, () => h('div', { class: 'col' }));
  list.forEach((w, i) => cols[i % n].append(card(w, i)));
  wall.replaceChildren(...cols);
  $('#empty').hidden = list.length > 0;
  $('#empty-t').textContent = person ? `No gifts for ${person.name} yet` : 'Nothing here yet';
  $('#empty-p').textContent = person ? 'Paste a link or a photo below to add a gift idea.'
    : 'Paste a link or a photo below, or press the plus button, to pin your first wish.';
}

function renderPeople(gifts) {
  $('#pgrid').replaceChildren(...st.people.map(p => {
    const g = gifts.filter(w => w.for.includes(p.id)), left = g.filter(w => !w.granted);
    return h('button', { class: 'pcard', onclick: () => { st.person = p.id; render(); } },
      h('span', { class: 'avatar fr', 'aria-hidden': 'true' }, ([...p.name][0] || '?').toUpperCase()),
      h('span', { class: 'pc-name fr' }, p.name),
      h('span', { class: 'pc-meta' }, `${plural(g.length, 'gift', 'gifts')} · ${money(sum(left))} to buy`),
      h('span', { class: 'pc-meta' }, `${g.filter(w => w.granted && !w.given).length} bought · ${g.filter(w => w.given).length} given`));
  }));
  if (!st.people.length) $('#pgrid').append(h('p', { class: 'note' }, 'Add someone above, then pin gift ideas under their name.'));
}

// Real columns instead of CSS columns: the browser's column splitting repeats the tape on some cards.
const wallCols = () => (innerWidth >= 1400 ? 4 : innerWidth >= 900 ? 3 : 2);
let lastCols = wallCols();
addEventListener('resize', () => { if (wallCols() !== lastCols) { lastCols = wallCols(); render(); } });

function card(w, i) {
  const open = () => openSheet(w);
  const thumb = w.image
    ? h('img', { src: w.image, alt: '', loading: 'lazy' })
    : h('div', { class: 'ph', style: `background:var(--t${(hash(w.id) % 4) + 1});height:${[84, 60, 104][i % 3]}px` }, h('i', { class: 'ti ti-gift' }));
  const meta = h('div', { class: 'meta' },
    w.link && h('a', { href: w.link, target: '_blank', rel: 'noopener noreferrer', onclick: e => e.stopPropagation() },
      h('i', { class: 'ti ti-link' }), ' ' + host(w.link)),
    w.group && h('span', {}, w.group),
    h('span', { class: 'stars-s', 'aria-label': `${w.priority} of 3 stars` }, '★'.repeat(w.priority)),
    !own(w) && h('span', { class: 'tag' }, h('i', { class: 'ti ti-gift' }), ' ' +
      (st.person ? '' : 'For ' + w.for.map(id => personOf(id)?.name).filter(Boolean).join(', ')) +
      (w.given ? (st.person ? 'Given' : ' · given') : w.granted ? (st.person ? 'Bought' : ' · bought') : (st.person ? 'To buy' : ''))));
  return h('article', {
    class: 'card' + (w.granted ? ' done' : ''), tabindex: '0', role: 'button', 'aria-label': `${w.name}, ${money(w.price)}`,
    style: `--r:${[-1.8, 1.4, 1.9, -1.2][i % 4]}deg`,
    onclick: open, onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } },
  }, h('span', { class: 'tape' }), h('div', { class: 'thumb' }, thumb, h('span', { class: 'price' }, money(w.price))),
  h('div', { class: 'body' }, h('div', { class: 'nm' }, w.name || 'Untitled'), meta));
}

$$('[data-view]').forEach(b => b.addEventListener('click', () => { st.view = b.dataset.view; st.person = ''; render(); }));
$('#pback').addEventListener('click', () => { st.person = ''; render(); });

$('#padd').addEventListener('submit', async e => {
  e.preventDefault();
  const r = await addPerson($('#pname').value);
  const err = $('#perr');
  err.hidden = !r.error; err.textContent = r.error || '';
  if (r.error) return;
  $('#pname').value = '';
  await refresh();
  toast(`${r.person.name} added`);
});

$('#pedit').addEventListener('click', async () => {
  const p = personOf(st.person);
  const name = (prompt('Rename person', p.name) || '').trim().slice(0, 40);
  if (!name || name === p.name) return;
  if (st.people.some(x => x.id !== p.id && x.name.toLowerCase() === name.toLowerCase())) return toast(`${name} is already on your list`);
  await putPerson({ ...p, name, updatedAt: Date.now() });
  await refresh();
});

$('#pdel').addEventListener('click', async () => {
  const p = personOf(st.person);
  const gifts = st.items.filter(w => w.for.includes(p.id)), only = gifts.filter(w => w.for.length === 1);
  const msg = `Delete ${p.name}?` + (only.length ? ` Their ${plural(only.length, 'gift', 'gifts')} will be deleted too.` : '') + ' This can’t be undone.';
  if (!confirm(msg)) return;
  const now = Date.now();
  for (const w of gifts) {
    await put(w.for.length === 1 ? { ...w, deleted: true, image: '', updatedAt: now } : { ...w, for: w.for.filter(x => x !== p.id), updatedAt: now });
  }
  await putPerson({ ...p, deleted: true, updatedAt: now });
  st.person = '';
  await refresh(); toast(`${p.name} deleted`);
});
$('#q').addEventListener('input', e => { st.q = e.target.value.trim(); render(); });
$('#group').addEventListener('change', e => { st.group = e.target.value; render(); });
$('#sort').addEventListener('change', e => { st.sort = e.target.value; render(); });

/* ---------- sheets ---------- */
let openEl = null;
function showSheet(el) {
  closeSheets();
  openEl = el; el.hidden = false; $('#scrim').hidden = false;
}
function closeSheets() {
  for (const el of [$('#sheet'), $('#sync')]) el.hidden = true;
  $('#scrim').hidden = true; openEl = null;
}
$('#scrim').addEventListener('click', closeSheets);
$('#sheet-x').addEventListener('click', closeSheets);
$('#sync-x').addEventListener('click', closeSheets);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && openEl) closeSheets(); });

/* ---------- add / edit wish ---------- */
function setStars(p) { $$('#stars button').forEach(b => b.classList.toggle('on', Number(b.dataset.p) <= p)); st.cur.priority = p; }
$$('#stars button').forEach(b => b.addEventListener('click', () => setStars(Number(b.dataset.p))));

function paintImage() {
  const box = $('#imgbox'), has = !!st.cur.image;
  box.replaceChildren(has ? h('img', { src: st.cur.image, alt: 'Photo of the wish' })
    : h('span', {}, h('i', { class: 'ti ti-photo-plus' }), h('b', {}, 'Paste or attach a photo'), h('small', {}, 'Ctrl+V works too')));
  $('#imgrm').hidden = !has;
}

function openSheet(w, pre = {}) {
  st.cur = w ? { ...w } : { ...newWish(), id: '', ...pre };
  const editing = !!w;
  $('#f-name').value = st.cur.name;
  $('#f-price').value = st.cur.price || '';
  $('#f-link').value = st.cur.link;
  $('#f-group').value = st.cur.group;
  $('#f-notes').value = st.cur.notes;
  $('#f-newp').value = '';
  $('#f-err').hidden = true;
  $('#f-del').hidden = !editing;
  const open = $('#f-open');
  open.hidden = !(editing && w.link);
  if (!open.hidden) open.href = w.link;
  setStars(st.cur.priority);
  paintImage();
  paintGift();
  showSheet($('#sheet'));
  if (!editing) $('#f-name').focus();
}

// The "Gift for" chips decide whether this is my wish or a gift, and the button labels follow.
function paintGift() {
  const c = st.cur, gift = c.for.length > 0, editing = !!c.id;
  $('#chips').replaceChildren(...st.people.map(p => h('button', {
    type: 'button', class: 'chip' + (c.for.includes(p.id) ? ' on' : ''), 'aria-pressed': c.for.includes(p.id),
    onclick: () => { c.for = c.for.includes(p.id) ? c.for.filter(x => x !== p.id) : [...c.for, p.id]; paintGift(); },
  }, p.name)));
  if (!st.people.length) $('#chips').append(h('span', { class: 'small' }, 'No people yet. Add one below.'));
  $('#sheet-title').textContent = (editing ? 'Edit ' : 'New ') + (gift ? 'gift' : 'wish');
  $('#f-save').textContent = editing ? 'Save changes' : gift ? 'Save gift' : 'Pin to my wall';
  $('#f-grant').hidden = !editing;
  $('#f-grant').textContent = c.granted ? (gift ? 'Move back to gifts to buy' : 'Move back to wall') : (gift ? 'Mark as bought' : 'Mark as granted');
  $('#f-give').hidden = !(editing && gift && c.granted);
  $('#f-give').textContent = c.given ? 'Not given yet' : 'Mark as given';
}

async function addPersonInline() {
  const r = await addPerson($('#f-newp').value);
  const p = $('#f-err');
  p.hidden = !r.error; p.textContent = r.error || '';
  if (r.error) return;
  st.people = (await getPeople()).filter(x => !x.deleted).sort((a, b) => a.name.localeCompare(b.name));
  st.cur.for = [...st.cur.for, r.person.id];
  $('#f-newp').value = '';
  paintGift();
}
$('#f-addp').addEventListener('click', addPersonInline);
$('#f-newp').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addPersonInline(); } });

function normLink(v) {
  v = v.trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  try { const u = new URL(v); return /^https?:$/.test(u.protocol) && u.hostname.includes('.') ? u.href : null; } catch { return null; }
}

async function processImage(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 800 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

async function setImage(file) {
  try { st.cur.image = await processImage(file); paintImage(); }
  catch { toast('That photo could not be read'); }
}

$('#imgbox').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) setImage(f); });
$('#imgrm').addEventListener('click', () => { st.cur.image = ''; paintImage(); });

$('#form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = m => { const p = $('#f-err'); p.textContent = m; p.hidden = false; };
  const name = $('#f-name').value.trim();
  const priceRaw = $('#f-price').value.replace(/[₱,\s]/g, '');
  const price = priceRaw === '' ? 0 : Number(priceRaw);
  const link = normLink($('#f-link').value);
  if (!name) return err('Enter a name for your wish.');
  if (!Number.isFinite(price) || price < 0) return err('Enter the price as a number, like 1250 or 1250.50.');
  if (link === null) return err('That link doesn’t look right. Paste the full address, like https://shop.com/item.');
  const base = st.cur.id ? st.cur : newWish();
  const forIds = st.cur.for;
  await put({ ...base, name, price, link, group: $('#f-group').value.trim(), notes: $('#f-notes').value.trim(),
    priority: st.cur.priority, image: st.cur.image, for: forIds, given: forIds.length ? !!st.cur.given : false,
    updatedAt: Date.now() });
  closeSheets(); await refresh();
  toast(st.cur.id ? 'Saved' : forIds.length ? 'Gift added' : 'Pinned to your wall');
});

$('#f-grant').addEventListener('click', async () => {
  const w = st.cur, gift = w.for.length > 0;
  await put({ ...w, granted: !w.granted, grantedAt: w.granted ? 0 : Date.now(), given: w.granted ? false : w.given, updatedAt: Date.now() });
  closeSheets(); await refresh();
  toast(w.granted ? (gift ? 'Moved back to gifts to buy' : 'Moved back to your wall') : gift ? 'Marked as bought' : 'Granted. Enjoy it!');
});

$('#f-give').addEventListener('click', async () => {
  const w = st.cur;
  await put({ ...w, given: !w.given, updatedAt: Date.now() });
  closeSheets(); await refresh();
  toast(w.given ? 'Marked as not given yet' : 'Marked as given');
});

$('#f-del').addEventListener('click', async () => {
  if (!confirm('Delete this wish? This can’t be undone.')) return;
  await put({ ...st.cur, deleted: true, image: '', updatedAt: Date.now() });
  closeSheets(); await refresh(); toast('Deleted');
});

/* ---------- quick add and paste ---------- */
const isUrl = t => /^https?:\/\/\S+$/i.test(t);
const forPerson = () => (st.person ? { for: [st.person] } : {}); // adding from a person's page makes it a gift for them
$('#quick').addEventListener('submit', e => {
  e.preventDefault();
  const t = $('#qin').value.trim();
  $('#qin').value = '';
  if (!t) return openSheet(null, forPerson());
  openSheet(null, { ...forPerson(), ...(isUrl(t) ? { link: t } : { name: t.slice(0, 200) }) });
});

document.addEventListener('paste', async e => {
  const imgFile = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/'));
  if (imgFile) {
    e.preventDefault();
    if ($('#sheet').hidden) openSheet(null, forPerson());
    return setImage(imgFile);
  }
  const t = (e.clipboardData?.getData('text') || '').trim();
  const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  if (isUrl(t) && $('#sheet').hidden && (e.target.id === 'qin' || !inField)) {
    e.preventDefault(); $('#qin').value = '';
    openSheet(null, { ...forPerson(), link: t });
  }
});

/* ---------- sync ---------- */
let sess = null, sent = false, got = null;
const step = name => $$('#sync [data-step]').forEach(d => { d.hidden = d.dataset.step !== name; });
const status = (msg, bad) => { const p = $('#s-status'); p.textContent = msg; p.hidden = !msg; p.style.background = bad ? 'var(--t1)' : ''; };

$$('[data-open-sync]').forEach(b => b.addEventListener('click', () => {
  sess?.close(); sess = null; status('');
  step('home'); $('#jout').hidden = true; $('#ask').hidden = true; $('#c-input').value = '';
  for (const id of ['#hcode', '#hreply', '#jcode', '#jreply']) $(id).value = '';
  showSheet($('#sync'));
}));

function newSession() {
  sess?.close(); sent = false; got = null;
  sess = createSession({ onState: onSyncState, onData: onSyncData });
  return sess;
}

function newShort() {
  sess?.close(); sent = false; got = null;
  sess = createShortSession({
    onState: onSyncState, onData: onSyncData,
    onAsk: (allow, deny) => {
      $('#ask').hidden = false; status('');
      $('#ask-yes').onclick = () => { $('#ask').hidden = true; status('Connecting…'); allow(); };
      $('#ask-no').onclick = () => { $('#ask').hidden = true; deny(); };
    },
  });
  return sess;
}

const FAIL = 'Couldn’t connect. Check that both devices are on the same Wi-Fi or router (not a guest network), then try again. You can also use a long code or a backup file.';

async function onSyncState(s) {
  if (s === 'open') {
    status('Connected. Syncing…');
    await sess.send({ t: 'all', items: await getAll(), people: await getPeople() });
    sent = true; finishSync();
  } else if (s === 'failed') status(FAIL, true);
  else if (s === 'waiting') status('Waiting for the other device to tap Allow…');
  else if (s === 'badcode') status('That code isn’t active. Check the 6 characters, or show a new code on the other device.', true);
  else if (s === 'denied') { status('You denied the connection.', true); step('home'); }
  else if (s === 'expired') { status('That code expired. Show a new one to try again.', true); step('home'); }
  else if (s === 'closed' && !(sent && got)) status('The connection closed before syncing finished.', true);
}

async function onSyncData(m) {
  if (m && m.t === 'all' && Array.isArray(m.items)) {
    await mergePeople(m.people); // people first so gifts never point at someone who isn't there yet
    got = await mergeAll(m.items); finishSync();
  }
}

async function finishSync() {
  if (!(sent && got)) return;
  lsSet('wb-last', String(Date.now()));
  status(`Synced. ${got.added} new, ${got.updated} updated.`);
  await refresh();
  setTimeout(() => sess?.close(), 1500);
}

$('#c-show').addEventListener('click', async () => {
  step('show'); status('');
  const box = $('#codebox'); box.textContent = 'Making your code…';
  try {
    const code = await newShort().host();
    box.replaceChildren(...[...code].map(c => h('span', {}, c)));
    box.setAttribute('aria-label', 'Your sync code is ' + [...code].join(' '));
  } catch {
    box.textContent = ''; step('home');
    status('Couldn’t reach the introduction service. Check your internet, or use a long code instead.', true);
  }
});
$('#c-enter').addEventListener('click', () => { step('enter'); status(''); $('#c-input').focus(); });
$('#c-input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#c-go').click(); } });
$('#c-go').addEventListener('click', async () => {
  const code = normCode($('#c-input').value);
  if (code.length !== 6) return status('Enter all 6 characters of the code.', true);
  status('Connecting…');
  try { await newShort().join(code); }
  catch { status('Couldn’t reach the introduction service. Check your internet, or use a long code instead.', true); }
});
$('#c-long').addEventListener('click', () => { step('manual'); status(''); });
$('#c-short').addEventListener('click', () => { step('home'); status(''); });

$('#s-start').addEventListener('click', async () => {
  step('host'); $('#hcode').value = 'Making your code…';
  try { $('#hcode').value = await newSession().host(); }
  catch { $('#hcode').value = ''; status('Couldn’t make a code. This browser may not support direct sync.', true); }
});
$('#s-join').addEventListener('click', () => { newSession(); step('join'); });
$('#s-connect').addEventListener('click', async () => {
  try { await sess.acceptReply($('#hreply').value); status('Connecting…'); }
  catch { status('That reply code isn’t valid. Copy the whole code from the other device.', true); }
});
$('#j-make').addEventListener('click', async () => {
  try {
    $('#jreply').value = await sess.join($('#jcode').value);
    $('#jout').hidden = false; status('Now paste this reply code on the other device.');
  } catch { status('That code isn’t valid. Copy the whole code from the other device.', true); }
});

async function copy(id) {
  const el = $(id);
  try { await navigator.clipboard.writeText(el.value); toast('Copied'); }
  catch { el.select(); toast('Select and copy the code'); }
}
$('#h-copy').addEventListener('click', () => copy('#hcode'));
$('#j-copy').addEventListener('click', () => copy('#jreply'));
for (const [btn, id] of [['#h-share', '#hcode'], ['#j-share', '#jreply']]) {
  if (navigator.share) $(btn).hidden = false;
  $(btn).addEventListener('click', () => navigator.share({ text: $(id).value }).catch(() => {}));
}

/* ---------- backup file ---------- */
$('#b-export').addEventListener('click', async () => {
  const data = JSON.stringify({ app: 'wishbone', version: 2, items: await getAll(), people: await getPeople() });
  const a = h('a', { href: URL.createObjectURL(new Blob([data], { type: 'application/json' })),
    download: `wishbone-backup-${new Date().toISOString().slice(0, 10)}.json` });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Backup saved');
});
$('#b-import').addEventListener('click', () => $('#b-file').click());
$('#b-file').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (j.app !== 'wishbone' || !Array.isArray(j.items)) throw new Error('not a backup');
    await mergePeople(j.people);
    const r = await mergeAll(j.items.map(clean).filter(Boolean));
    await refresh(); toast(`Imported. ${r.added} new, ${r.updated} updated.`);
  } catch { status('That file isn’t a Wishbone backup.', true); }
});

/* ---------- start ---------- */
applyTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
refresh();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
