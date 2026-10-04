// IndexedDB mínimo para lo que tiene que sobrevivir a cerrar la app o a
// reiniciar el móvil: la cola de escrituras sin red (`cola`) y la última copia
// de las lecturas del técnico (`lecturas`). Si el navegador no deja (modo
// privado), todo falla en silencio y el hub sigue como siempre, con red.
const NOMBRE = 'hub-local';
const VERSION = 1;
let _db: Promise<IDBDatabase> | null = null;
export let idbDisponible = typeof indexedDB !== 'undefined';

function abrir(): Promise<IDBDatabase> {
  return (_db ??= new Promise((ok, mal) => {
    const r = indexedDB.open(NOMBRE, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('cola')) db.createObjectStore('cola', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('lecturas')) db.createObjectStore('lecturas', { keyPath: 'clave' });
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => { idbDisponible = false; mal(r.error); };
  }));
}

export async function idb<T>(almacen: 'cola' | 'lecturas', modo: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T> {
  const db = await abrir();
  return new Promise((ok, mal) => {
    const tx = db.transaction(almacen, modo);
    let req: IDBRequest | void;
    try { req = fn(tx.objectStore(almacen)); } catch (e) { mal(e); return; }
    tx.oncomplete = () => ok((req ? req.result : undefined) as T);
    tx.onerror = () => mal(tx.error);
    tx.onabort = () => mal(tx.error);
  });
}
