import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { parseBarcode as appParseBarcode } from "../src/lib/barcode.js";

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
  for (const sample of [
    " p76186a 06*28 ",
    "P79710A0620",
    "P79710A01220",
    "*p79710a 012*20*",
    "P61109A",
    "P71980RA",
    "P72868RRA",
    "",
    null,
    "12345",
    "P79710A0",
    "P79710A06",
    "P79710A0020",
    "P79710A9920",
    "P79710A0600",
    "P79710A100120",
    "P79710A-0620",
    "not a barcode",
  ]) {
    assert.deepEqual(
      JSON.parse(JSON.stringify(store.parseBarcode(sample))),
      appParseBarcode(sample),
      `parity mismatch for ${String(sample)}`,
    );
  }
  assert.equal(store.normalizeBarcode(" p76186a 06*28 "), "P76186A0628");
  assert.equal(store.normalizeBarcode(" p79710a 012*20 "), "P79710A01220");
});

test("preserves full barcodes and deduplicates per full barcode across different pages of the same paper", () => {
  const store = createStore();
  store.recordScan("P79710A0620", store.parseBarcode("P79710A0620"), 100);
  store.recordScan("P79710A01220", store.parseBarcode("P79710A01220"), 200);
  store.recordScan("P79710A", store.parseBarcode("P79710A"), 300);

  let history = JSON.parse(JSON.stringify(store.get().history));
  assert.deepEqual(history, [
    { barcode: "P79710A", code: "P79710A", page: null, total: null, scannedAt: 300 },
    { barcode: "P79710A01220", code: "P79710A", page: 12, total: 20, scannedAt: 200 },
    { barcode: "P79710A0620", code: "P79710A", page: 6, total: 20, scannedAt: 100 },
  ]);

  // Re-scanning P79710A0620 deduplicates only that exact barcode and moves it to index 0
  store.recordScan(" p79710a 06*20 ", store.parseBarcode("P79710A0620"), 400);
  history = JSON.parse(JSON.stringify(store.get().history));
  assert.deepEqual(history, [
    { barcode: "P79710A0620", code: "P79710A", page: 6, total: 20, scannedAt: 400 },
    { barcode: "P79710A", code: "P79710A", page: null, total: null, scannedAt: 300 },
    { barcode: "P79710A01220", code: "P79710A", page: 12, total: 20, scannedAt: 200 },
  ]);
});
