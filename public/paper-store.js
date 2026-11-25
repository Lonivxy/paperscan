(function attachPaperStore(root) {
  "use strict";

  const key = "paperscan-library-v1";
  const historyLimit = 50;
  const codePattern = /^P\d{5,7}[A-Z]{1,3}$/;
  let memoryState = emptyState();
  let storageFailed = false;

  function emptyState() {
    return { version: 1, history: [], favorites: [], feedback: { sound: false, vibration: false } };
  }

  /** The one runtime barcode grammar. src/lib/barcode.js mirrors this for the bundled app. */
  function normalizeBarcode(value) {
    return typeof value === "string" ? value.toUpperCase().replace(/[\s*]/g, "") : "";
  }

  function parseBarcode(raw) {
    const match = /^(P\d{5,7}[A-Z]{1,3})(\d*)$/.exec(normalizeBarcode(raw));
    if (!match) return null;
    const suffix = match[2];
    if (!suffix) return { code: match[1], page: null, total: null };
    if (suffix.length < 3) return null;
    const page = Number.parseInt(suffix.slice(0, -2), 10);
    const total = Number.parseInt(suffix.slice(-2), 10);
    return page > 0 && page <= total ? { code: match[1], page, total } : null;
  }

  function validCode(value) {
    return typeof value === "string" && codePattern.test(value);
  }

  function sanitize(value) {
    if (!value || typeof value !== "object" || value.version !== 1) return emptyState();
    const history = Array.isArray(value.history)
      ? value.history.flatMap((entry) => {
          if (!entry || typeof entry !== "object" || typeof entry.barcode !== "string" || !validCode(entry.code)) return [];
          const normalizedBarcode = normalizeBarcode(entry.barcode);
          const parsedBarcode = parseBarcode(normalizedBarcode);
          const page = Number.isInteger(entry.page) && entry.page > 0 ? entry.page : (parsedBarcode?.page ?? null);
          const total = Number.isInteger(entry.total) && entry.total > 0 ? entry.total : (parsedBarcode?.total ?? null);
          return [{
            barcode: normalizedBarcode,
            code: entry.code,
            page,
            total,
            scannedAt: Number.isFinite(entry.scannedAt) && Math.abs(entry.scannedAt) <= 8640000000000000 ? entry.scannedAt : Date.now(),
          }];
        }).slice(0, historyLimit)
      : [];
    const favorites = Array.isArray(value.favorites)
      ? [...new Set(value.favorites.filter(validCode))]
      : [];
    return {
      version: 1,
      history,
      favorites,
      feedback: {
        sound: value.feedback?.sound === true,
        vibration: value.feedback?.vibration === true,
      },
    };
  }

  function copy(state) {
    return JSON.parse(JSON.stringify(state));
  }

  function get() {
    try {
      const stored = root.localStorage.getItem(key);
      if (stored === null) {
        // The key can be removed by another tab or a site-data clear. Reflect
        // that instead of resurrecting the old copy — but when writes are
        // failing, the missing key is expected and the session copy must hold.
        if (!storageFailed) memoryState = emptyState();
      } else {
        memoryState = sanitize(JSON.parse(stored));
        storageFailed = false;
      }
    } catch {
      // Storage is unavailable; keep serving the in-memory copy for this session.
    }
    return copy(memoryState);
  }

  function save(state) {
    memoryState = sanitize(state);
    try {
      root.localStorage.setItem(key, JSON.stringify(memoryState));
      storageFailed = false;
      return { state: copy(memoryState), persisted: true };
    } catch {
      storageFailed = true;
      return { state: copy(memoryState), persisted: false };
    }
  }

  function recordScan(barcode, parsed, scannedAt = Date.now()) {
    const normalized = normalizeBarcode(barcode);
    const resolved = parsed ?? parseBarcode(normalized);
    if (!validCode(resolved?.code) || !normalized.startsWith(resolved.code)) return { state: get(), persisted: false };
    const page = Number.isInteger(resolved.page) && resolved.page > 0 ? resolved.page : null;
    const total = Number.isInteger(resolved.total) && resolved.total > 0 ? resolved.total : null;
    const state = get();
    state.history = [{
      barcode: normalized,
      code: resolved.code,
      page,
      total: page && total && page <= total ? total : (page ? null : total),
      scannedAt,
    }, ...state.history.filter((entry) => entry.barcode !== normalized)].slice(0, historyLimit);
    return save(state);
  }

  function toggleFavorite(code) {
    if (!validCode(code)) return { state: get(), active: false, persisted: false };
    const state = get();
    const active = !state.favorites.includes(code);
    state.favorites = active
      ? [code, ...state.favorites]
      : state.favorites.filter((favorite) => favorite !== code);
    return { ...save(state), active };
  }

  function setFeedback(patch) {
    const state = get();
    state.feedback = {
      sound: typeof patch?.sound === "boolean" ? patch.sound : state.feedback.sound,
      vibration: typeof patch?.vibration === "boolean" ? patch.vibration : state.feedback.vibration,
    };
    return save(state);
  }

  function clearHistory() {
    const state = get();
    state.history = [];
    return save(state);
  }

  root.PaperScanStore = Object.freeze({
    key,
    get,
    normalizeBarcode,
    parseBarcode,
    recordScan,
    toggleFavorite,
    isFavorite: (code) => get().favorites.includes(code),
    setFeedback,
    clearHistory,
  });
})(typeof window === "undefined" ? globalThis : window);
