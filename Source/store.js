/*
 * Shared storage helper (background, popup, manager).
 *
 * Rules that prevent data loss:
 *  - Never write a whole snapshot. Each write touches exactly one key.
 *  - Every read-modify-write re-reads fresh data from storage first.
 *  - Writes are serialized across all extension pages with a Web Lock.
 */
const Store = (() => {
  const DEFAULTS = { enabled: true, styles: [], globalCss: '', theme: 'auto' };
  const clone = v => JSON.parse(JSON.stringify(v));
  const lock = fn =>
    typeof navigator !== 'undefined' && navigator.locks
      ? navigator.locks.request('stylo-store', fn)
      : fn();

  return {
    DEFAULTS,

    async get() {
      const d = await browser.storage.local.get(DEFAULTS);
      if (!Array.isArray(d.styles)) d.styles = [];
      return d;
    },

    // Re-read `key`, pass it to fn, write the result. If fn returns the same
    // reference it was given, nothing is written. Resolves to the final value.
    update(key, fn) {
      return lock(async () => {
        const stored = (await browser.storage.local.get(key))[key];
        let cur = stored === undefined ? clone(DEFAULTS[key]) : stored;
        if (key === 'styles' && !Array.isArray(cur)) cur = [];
        const next = await fn(cur);
        if (next !== cur) await browser.storage.local.set({ [key]: next });
        return next;
      });
    },

    // Write several already-validated keys in one storage operation, while
    // serializing against the other read-modify-write operations in this app.
    setMany(values) {
      return lock(() => browser.storage.local.set(values));
    },

    // Write only the keys that do not exist yet. Never overwrites user data.
    fillDefaults(extra = {}) {
      return lock(async () => {
        const cur = await browser.storage.local.get(null);
        const missing = {};
        for (const [k, v] of Object.entries({ ...DEFAULTS, ...extra })) {
          if (!(k in cur)) missing[k] = v;
        }
        if (Object.keys(missing).length) await browser.storage.local.set(missing);
      });
    }
  };
})();
