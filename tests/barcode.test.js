import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBarcode, parseBarcode } from "../src/lib/barcode.js";

test("parses a complete publication barcode and its page count", () => {
  assert.deepEqual(parseBarcode("P76186A0628"), {
    code: "P76186A",
    page: 6,
    total: 28,
  });
});

test("normalizes spaces, asterisks, and letter case", () => {
  assert.deepEqual(parseBarcode(" p76186a 06*28 "), {
    code: "P76186A",
    page: 6,
    total: 28,
  });
});

test("accepts a publication code without a page suffix", () => {
  assert.deepEqual(parseBarcode("P76186A"), {
    code: "P76186A",
    page: null,
    total: null,
  });
  assert.equal(normalizeBarcode("P76186A"), "P76186A");
});

test("rejects malformed and impossible page suffixes", () => {
  assert.equal(parseBarcode("76186A0628"), null);
  assert.equal(parseBarcode("P76186A0028"), null);
  assert.equal(parseBarcode("P76186A2928"), null);
  assert.equal(normalizeBarcode("not a barcode"), null);
});
