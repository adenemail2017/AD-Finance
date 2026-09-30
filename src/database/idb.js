/**
 * Storage layer — IndexedDB primary, with a safe in-memory + localStorage
 * fallback (private browsing, blocked storage, sandboxed iframes).
 *
 * Collections are tiny (personal finance data), so the whole DB is kept in
 * memory at boot for instant queries; every mutation is written through to
 * persistent storage.
 */

export const DB_NAME = 'pfos';
export const DB_VERSION = 1;

export const STORES = {
  users: 'id',
  profiles: 'id',
  accounts: 'id',
  transactions: 'id',
  categories: 'id',
  debts: 'id',
  debt_payments: 'id',
  receivables: 'id',
  receivable_payments: 'id',
  budgets: 'id',
  notifications: 'id',
  settings: 'key',
  outbox: 'id',
  meta: 'key',
};

let dbPromise = null;
let usingFallback = false;
const memory = new Map();

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      Object.entries(STORES).forEach(([name, keyPath]) => {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath });
          if (name === 'transactions') {
            store.createIndex('date', 'date');
            store.createIndex('type', 'transaction_type');
            store.createIndex('account', 'account_id');
          }
          if (name === 'notifications') store.createIndex('created_at', 'created_at');
        }
      });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  }).catch((err) => {
    console.warn('[storage] IndexedDB unavailable, using fallback:', err.message);
    usingFallback = true;
    return null;
  });
  return dbPromise;
}

function fallbackKey(store) {
  return `pfos:${store}`;
}

function readFallback(store) {
  if (memory.has(store)) return memory.get(store);
  try {
    const raw = localStorage.getItem(fallbackKey(store));
    const arr = raw ? JSON.parse(raw) : [];
    memory.set(store, arr);
    return arr;
  } catch {
    memory.set(store, []);
    return memory.get(store);
  }
}

let warnedAboutStorage = false;

function writeFallback(store, rows) {
  memory.set(store, rows);
  try {
    localStorage.setItem(fallbackKey(store), JSON.stringify(rows));
  } catch {
    // Sandboxed frame / private mode: keep going in memory, but say it once so
    // the console is not flooded on every single write.
    if (!warnedAboutStorage) {
      warnedAboutStorage = true;
      console.warn('[storage] penyimpanan browser tidak tersedia — data hanya bertahan selama sesi ini.');
    }
  }
}

function tx(store, mode) {
  return openDB().then((db) => {
    if (!db) return null;
    return db.transaction(store, mode).objectStore(store);
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function isFallbackMode() {
  return usingFallback;
}

/**
 * Where does data actually live right now?
 *  'indexeddb' — durable, survives reloads and browser restarts
 *  'local'     — IndexedDB blocked, but localStorage works (still durable)
 *  'memory'    — nothing is writable (sandboxed frame / private mode):
 *                everything works, but only for this tab session.
 */
export function persistenceMode() {
  if (!usingFallback) return 'indexeddb';
  try {
    const probe = '__pfos_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return 'local';
  } catch {
    return 'memory';
  }
}

/** Human copy for the current persistence level (id-ID, user facing). */
export function persistenceLabel() {
  switch (persistenceMode()) {
    case 'indexeddb': return { mode: 'Penyimpanan penuh', desc: 'Data tersimpan permanen di perangkat ini.', tone: 'pos' };
    case 'local': return { mode: 'Mode kompatibilitas', desc: 'Data tersimpan di localStorage browser ini.', tone: 'warn' };
    default: return { mode: 'Mode sesi (memori)', desc: 'Penyimpanan browser diblokir, jadi data hanya bertahan selama tab ini terbuka. Unduh file aplikasinya dan buka langsung di browser untuk penyimpanan permanen.', tone: 'warn' };
  }
}

export async function getAll(store) {
  const db = await openDB();
  if (!db) return readFallback(store);
  const objectStore = await tx(store, 'readonly');
  return requestToPromise(objectStore.getAll());
}

export async function get(store, key) {
  const db = await openDB();
  if (!db) {
    const rows = readFallback(store);
    const keyPath = STORES[store];
    return rows.find((r) => r[keyPath] === key) || null;
  }
  const objectStore = await tx(store, 'readonly');
  return requestToPromise(objectStore.get(key));
}

export async function put(store, value) {
  const db = await openDB();
  if (!db) {
    const rows = readFallback(store);
    const keyPath = STORES[store];
    const idx = rows.findIndex((r) => r[keyPath] === value[keyPath]);
    if (idx > -1) rows[idx] = value; else rows.push(value);
    writeFallback(store, rows);
    return value;
  }
  const objectStore = await tx(store, 'readwrite');
  await requestToPromise(objectStore.put(value));
  return value;
}

export async function putMany(store, values) {
  if (!values.length) return values;
  const db = await openDB();
  if (!db) {
    const rows = readFallback(store);
    const keyPath = STORES[store];
    values.forEach((value) => {
      const idx = rows.findIndex((r) => r[keyPath] === value[keyPath]);
      if (idx > -1) rows[idx] = value; else rows.push(value);
    });
    writeFallback(store, rows);
    return values;
  }
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, 'readwrite');
    const objectStore = transaction.objectStore(store);
    values.forEach((v) => objectStore.put(v));
    transaction.oncomplete = () => resolve(values);
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function remove(store, key) {
  const db = await openDB();
  if (!db) {
    const keyPath = STORES[store];
    const rows = readFallback(store).filter((r) => r[keyPath] !== key);
    writeFallback(store, rows);
    return true;
  }
  const objectStore = await tx(store, 'readwrite');
  await requestToPromise(objectStore.delete(key));
  return true;
}

export async function removeMany(store, keys) {
  if (!keys.length) return true;
  const db = await openDB();
  if (!db) {
    const keyPath = STORES[store];
    const set = new Set(keys);
    writeFallback(store, readFallback(store).filter((r) => !set.has(r[keyPath])));
    return true;
  }
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, 'readwrite');
    const objectStore = transaction.objectStore(store);
    keys.forEach((k) => objectStore.delete(k));
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function clearStore(store) {
  const db = await openDB();
  if (!db) {
    writeFallback(store, []);
    return true;
  }
  const objectStore = await tx(store, 'readwrite');
  await requestToPromise(objectStore.clear());
  return true;
}

export async function clearAll() {
  await Promise.all(Object.keys(STORES).map((s) => clearStore(s)));
  return true;
}

/** Storage estimate for the Settings → storage card. */
export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota, percent: quota ? (usage / quota) * 100 : 0, mode: usingFallback ? 'localStorage' : 'IndexedDB' };
  } catch {
    return null;
  }
}

/** Ask the browser to keep our data (Chrome/Edge persistent storage). */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* ignore */ }
  return false;
}
