import { TeacherDocument } from './pdfExtractor';

/**
 * IndexedDB persistence for uploaded notes.
 *
 * Documents used to live in memory only, so every page refresh threw away the extracted
 * text, the diagram crops AND the LLM-built tree — meaning the whole index had to be paid
 * for again. localStorage is not an option: a single scanned page is a multi-megabyte data
 * URL and the 5 MB quota is gone after two of them.
 *
 * Raw IndexedDB rather than a wrapper library.
 *
 * Images are stored as records of their own, not inside the document. Chromium caps a
 * single IndexedDB value at about 133 MB, and a lecture deck — a full-page render per page
 * plus every embedded picture — goes past that easily: a 145-page deck failed to save, the
 * failure went only to the console, and the deck vanished on the next refresh. One record
 * per image keeps every value small whatever the size of the document.
 */

const DB_NAME = 'slate-notes';
const DB_VERSION = 2;
const STORE = 'documents';
const IMAGES = 'images';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(IMAGES)) {
        db.createObjectStore(IMAGES, { keyPath: 'id' }).createIndex('docId', 'docId');
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
  });

  // A failed open must not poison every later call with the same rejected promise.
  dbPromise.catch(() => {
    dbPromise = null;
  });

  return dbPromise;
}

interface StoredImage {
  id: string;
  docId: string;
  dataUrl: string;
}

/** Runs work across both stores in one transaction, resolving when it commits. */
function runWrite(work: (docs: IDBObjectStore, images: IDBObjectStore) => void): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE, IMAGES], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
        tx.onerror = () => reject(tx.error || new Error('IndexedDB request failed'));
        work(tx.objectStore(STORE), tx.objectStore(IMAGES));
      })
  );
}

function getAll<T>(storeName: string): Promise<T[]> {
  return openDb().then(
    (db) =>
      new Promise<T[]>((resolve, reject) => {
        const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
        request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
        request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
      })
  );
}

/**
 * Replaces one document's stored images, inside an open transaction.
 *
 * The stale keys are read first and only the writes are issued once they are known. The
 * first version opened a cursor to delete the old images and queued the new ones straight
 * after; a cursor steps one record per request, and each step was queued behind the
 * writes, so on any second save of a document it walked onto the images just written and
 * deleted them. A deck saved again after indexing kept its descriptions and lost every
 * picture.
 */
function replaceImagesOf(images: IDBObjectStore, docId: string, next: StoredImage[], then: () => void) {
  const keep = new Set(next.map((img) => img.id));
  const request = images.index('docId').getAllKeys(IDBKeyRange.only(docId));
  request.onsuccess = () => {
    for (const key of request.result) {
      if (!keep.has(String(key))) images.delete(key);
    }
    for (const img of next) images.put(img);
    then();
  };
}

/**
 * Writes one document, its images as separate records. Returns whether it was saved, so
 * the caller can tell the teacher — a failure that only reaches the console looks exactly
 * like success until the next refresh loses the document.
 */
export async function persistDocument(doc: TeacherDocument): Promise<boolean> {
  try {
    await runWrite((docs, images) => {
      // Replace, not merge: a re-extracted document may have fewer images than before.
      const next = doc.images.map((img): StoredImage => ({ id: img.id, docId: doc.id, dataUrl: img.dataUrl }));
      replaceImagesOf(images, doc.id, next, () => {
        docs.put({ ...doc, images: doc.images.map((img) => ({ ...img, dataUrl: '' })) });
      });
    });
    return true;
  } catch (err) {
    console.warn(`Could not persist "${doc.filename}" — it will be lost on refresh:`, err);
    return false;
  }
}

export async function removePersistedDocument(docId: string): Promise<void> {
  try {
    await runWrite((docs, images) => {
      docs.delete(docId);
      replaceImagesOf(images, docId, [], () => {});
    });
  } catch (err) {
    console.warn('Could not delete persisted document:', err);
  }
}

export async function clearPersistedDocuments(): Promise<void> {
  try {
    await runWrite((docs, images) => {
      docs.clear();
      images.clear();
    });
  } catch (err) {
    console.warn('Could not clear persisted documents:', err);
  }
}

export async function loadPersistedDocuments(): Promise<TeacherDocument[]> {
  try {
    const [docs, images] = await Promise.all([getAll<TeacherDocument>(STORE), getAll<StoredImage>(IMAGES)]);
    const byId = new Map(images.map((img) => [img.id, img.dataUrl]));
    return docs.map((doc) => ({
      ...doc,
      // Documents saved before images were split out still carry their data inline.
      images: doc.images
        .map((img) => ({ ...img, dataUrl: img.dataUrl || byId.get(img.id) || '' }))
        .filter((img) => img.dataUrl)
    }));
  } catch (err) {
    console.warn('Could not load persisted documents:', err);
    return [];
  }
}
