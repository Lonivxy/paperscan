import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../public/paper-store.js", import.meta.url), "utf8");

function createStore({ failWrites = false } = {}) {
  const values = new Map();
  const localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (failWrites) throw new Error("Storage is unavailable");
      values.set(key, value);
    },
    removeItem: (key) => { values.delete(key); },
  };
  const window = { localStorage };
  vm.runInNewContext(source, { window, Date, JSON, Object, Array, RegExp, Number, String });
  return Object.assign(Object.create(window.PaperScanStore), { storage: localStorage });
}

test("stores recent scans, deduplicates the same barcode, and caps history", () => {
  const store = createStore();
  const parsed = { code: "P76186A", page: 6, total: 28 };
  store.recordScan("P76186A0628", parsed, 100);
  store.recordScan("P76186A0628", parsed, 200);
  assert.equal(store.get().history.length, 1);
  assert.equal(store.get().history[0].scannedAt, 200);
  for (let index = 0; index < 55; index += 1) {
    const code = `P${String(80000 + index).padStart(5, "0")}A`;
    store.recordScan(code, { code, page: null, total: null }, 300 + index);
  }
  const state = store.get();
  assert.equal(state.history.length, 50);
  assert.equal(state.history.some((entry) => entry.barcode === "P76186A0628"), false);
  const recent = store.get();
  assert.equal(recent.history[0].scannedAt, 354);
});

test("favorites and feedback settings persist across store instances", () => {
  const store = createStore();
  assert.equal(store.toggleFavorite("P76186A").active, true);
  store.setFeedback({ sound: true, vibration: true });
  assert.deepEqual(JSON.parse(JSON.stringify(store.get().favorites)), ["P76186A"]);
  assert.deepEqual(JSON.parse(JSON.stringify(store.get().feedback)), { sound: true, vibration: true });
  assert.equal(store.toggleFavorite("P76186A").active, false);
});

test("keeps the current session usable when local storage writes fail", () => {
  const store = createStore({ failWrites: true });
  const result = store.toggleFavorite("P76186A");
  assert.equal(result.persisted, false);
  assert.equal(store.isFavorite("P76186A"), true);
});

test("drops the in-memory copy when the storage key is removed elsewhere", () => {
  const store = createStore();
  store.toggleFavorite("P76186A");
  store.recordScan("P76186A0628", { code: "P76186A", page: 6, total: 28 }, 100);
  assert.equal(store.get().history.length, 1);
  store.storage.removeItem(store.key);
  assert.deepEqual(store.get().favorites, []);
  assert.deepEqual(store.get().history, []);
});

test("the store exposes the same barcode parsing as the app", () => {
  const store = createStore();
  assert.deepEqual(JSON.parse(JSON.stringify(store.parseBarcode(" p76186a 06*28 "))), { code: "P76186A", page: 6, total: 28 });
  assert.equal(store.parseBarcode("not a barcode"), null);
  assert.equal(store.normalizeBarcode(" p76186a 06*28 "), "P76186A0628");
});
