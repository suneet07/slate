/* @ts-nocheck */
/**
 * Minimal browser globals for suites that reach code touching the zustand store.
 *
 * Must be the FIRST import in such a suite: ES modules run their dependencies in order, so
 * anything imported above this line would evaluate before the stubs exist.
 */

const store = new Map<string, string>();

if (!(globalThis as any).localStorage) {
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k) : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear()
  };
}

if (!(globalThis as any).window) {
  (globalThis as any).window = globalThis;
}

if (typeof (globalThis as any).window.innerWidth !== 'number') {
  (globalThis as any).window.innerWidth = 1440;
  (globalThis as any).window.innerHeight = 900;
}

export {};
