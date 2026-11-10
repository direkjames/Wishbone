// Storage (IndexedDB) and the merge rules used by sync and backup import.
const DB = 'wishbone', STORE = 'wishes';
let dbp;

function open() {
  return (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => res(out && out.result);
    t.onerror = () => rej(t.error);
  });
}

export const getAll = () => tx('readonly', s => s.getAll());
export const put = w => tx('readwrite', s => s.put(w));

export function newWish() {
  const now = Date.now();
  return {
    id: crypto.randomUUID(), name: '', price: 0, link: '', notes: '', group: '',
    priority: 2, image: '', granted: false, grantedAt: 0, deleted: false,
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
    deleted: r.deleted === true,
    createdAt: Number(r.createdAt) || 0,
    updatedAt: Number(r.updatedAt) || 0,
  };
}

// Newest edit wins. Deleted wishes stay as tombstones so a delete also reaches the other device.
export const wins = (local, remote) => !local || remote.updatedAt > local.updatedAt;

export async function mergeAll(list) {
  const local = new Map((await getAll()).map(w => [w.id, w]));
  const take = [];
  let added = 0, updated = 0;
  for (const raw of Array.isArray(list) ? list.slice(0, 5000) : []) {
    const r = clean(raw);
    if (!r) continue;
    const l = local.get(r.id);
    if (!wins(l, r)) continue;
    take.push(r);
    if (l) updated++; else if (!r.deleted) added++;
  }
  if (take.length) await tx('readwrite', s => { take.forEach(r => s.put(r)); });
  return { added, updated };
}
