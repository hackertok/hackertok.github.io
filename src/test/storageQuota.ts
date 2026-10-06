/**
 * Swaps in a localStorage that throws, as a browser does, once its keys and
 * values would pass `limit` characters. `fill` takes up whatever room is left;
 * `restore` swaps the usual storage back.
 */
export function installStorageQuota(limit: number): { fill: () => void; restore: () => void } {
  const original = globalThis.localStorage;
  const store = new Map<string, string>();
  const used = () => {
    let chars = 0;
    for (const [key, value] of store) chars += key.length + value.length;
    return chars;
  };

  const storage = {
    get length() { return store.size; },
    key: (index: number) => [...store.keys()][index] ?? null,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      const replaced = store.has(key) ? key.length + store.get(key)!.length : 0;
      if (used() - replaced + key.length + value.length > limit) {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      }
      store.set(key, String(value));
    },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
  };

  const install = (value: unknown) =>
    Object.defineProperty(globalThis, 'localStorage', { value, writable: true, configurable: true });
  install(storage);

  return {
    fill: () => {
      const key = 'test:filler';
      storage.setItem(key, 'z'.repeat(limit - used() - key.length));
    },
    restore: () => { install(original); },
  };
}
