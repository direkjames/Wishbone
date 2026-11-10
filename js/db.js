// Storage (IndexedDB) and the merge rules used by sync and backup import.
const DB = 'wishbone', WISHES = 'wishes', PEOPLE = 'people';
let dbp;

function open() {
  return (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains(WISHES)) d.createObjectStore(WISHES, { keyPath: 'id' });
      if (!d.objectStoreNames.contains(PEOPLE)) d.createObjectStore(PEOPLE, { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => res(out && out.result);
    t.onerror = () => rej(t.error);
  });
}

export const getAll = () => tx(WISHES, 'readonly', s => s.getAll());
export const put = w => tx(WISHES, 'readwrite', s => s.put(w));
export const getPeople = () => tx(PEOPLE, 'readonly', s => s.getAll());
export const putPerson = p => tx(PEOPLE, 'readwrite', s => s.put(p));

export function newWish() {
  const now = Date.now();
  return {
    id: crypto.randomUUID(), name: '', price: 0, link: '', notes: '', group: '',
    priority: 2, image: '', granted: false, grantedAt: 0, for: [], given: false, deleted: false,
    createdAt: now, updatedAt: now,
  };
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

// Anything from another device or a backup file is untrusted: rebuild it field by field.
export function clean(r) {
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id || r.id.length > 64) return null;
  const price = Number(r.price);
  const link = str(r.link, 1000);
  const image = str(r.image, 450000);
  const forIds = Array.isArray(r.for) ? r.for.filter(x => typeof x === 'string' && x && x.length <= 64) : [];
  return {
    id: r.id,
    name: str(r.name, 200),
    price: Number.isFinite(price) && price >= 0 ? Math.min(price, 1e9) : 0,
    link: /^https?:\/\//i.test(link) ? link : '',
    notes: str(r.notes, 2000),
    group: str(r.group, 40),
    priority: [1, 2, 3].includes(r.priority) ? r.priority : 2,
    image: image.startsWith('data:image/') ? image : '',
    granted: r.granted === true,
    grantedAt: Number(r.grantedAt) || 0,
    for: [...new Set(forIds)].slice(0, 20),
    given: r.given === true,
    deleted: r.deleted === true,
    createdAt: Number(r.createdAt) || 0,
    updatedAt: Number(r.updatedAt) || 0,
  };
}

export function cleanPerson(r) {
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id || r.id.length > 64) return null;
  return {
    id: r.id, name: str(r.name, 40).trim(), deleted: r.deleted === true,
    createdAt: Number(r.createdAt) || 0, updatedAt: Number(r.updatedAt) || 0,
  };
}

// The id comes from the name, so adding "Mom" on two devices gives one person after sync.
export const personId = name =>
  'p-' + (name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'person');

export async function addPerson(raw) {
  const name = String(raw || '').trim().slice(0, 40);
  if (!name) return { error: 'Enter a name.' };
  const all = await getPeople();
  if (all.some(p => !p.deleted && p.name.toLowerCase() === name.toLowerCase()))
    return { error: `${name} is already on your list.` };
  let id = personId(name);
  const old = all.find(p => p.id === id);
  if (old && !old.deleted) id += '-' + Math.random().toString(36).slice(2, 5); // id taken by a renamed person
  const now = Date.now();
  const person = { id, name, deleted: false, createdAt: old ? old.createdAt : now, updatedAt: now };
  await putPerson(person);
  return { person };
}

// Newest edit wins. Deleted records stay as tombstones so a delete also reaches the other device.
export const wins = (local, remote) => !local || remote.updatedAt > local.updatedAt;

async function mergeInto(store, list, cleaner) {
  const local = new Map((await tx(store, 'readonly', s => s.getAll())).map(w => [w.id, w]));
  const take = [];
  let added = 0, updated = 0;
  for (const raw of Array.isArray(list) ? list.slice(0, 5000) : []) {
    const r = cleaner(raw);
    if (!r) continue;
    const l = local.get(r.id);
    if (!wins(l, r)) continue;
    take.push(r);
    if (l) updated++; else if (!r.deleted) added++;
  }
  if (take.length) await tx(store, 'readwrite', s => { take.forEach(r => s.put(r)); });
  return { added, updated };
}

export const mergeAll = list => mergeInto(WISHES, list, clean);
export const mergePeople = list => mergeInto(PEOPLE, list, cleanPerson);
