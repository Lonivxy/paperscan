import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildPdfPageUrl,
  cleanBarcode,
  normalizeBarcode,
  parseBarcode,
  prepareScanResultTarget,
} from "../src/lib/barcode.js";

test("parses a complete publication barcode and its page count", () => {
  assert.deepEqual(parseBarcode("P76186A0628"), {
    code: "P76186A",
    page: 6,
    total: 28,
  });
  assert.deepEqual(parseBarcode("P79710A0620"), {
    code: "P79710A",
    page: 6,
    total: 20,
  });
  assert.deepEqual(parseBarcode("P79710A01220"), {
    code: "P79710A",
    page: 12,
    total: 20,
  });
});

test("parses 2-digit and 3-digit pages, whitespace/asterisks, and multi-letter base codes", () => {
  assert.deepEqual(parseBarcode(" p76186a 06*28 "), {
    code: "P76186A",
    page: 6,
    total: 28,
  });
  assert.deepEqual(parseBarcode("P79710A09999"), {
    code: "P79710A",
    page: 99,
    total: 99,
  });
  assert.deepEqual(parseBarcode("P79710A620"), {
    code: "P79710A",
    page: 6,
    total: 20,
  });
  assert.deepEqual(parseBarcode("*p79710a 012*20*"), {
    code: "P79710A",
    page: 12,
    total: 20,
  });
  assert.deepEqual(parseBarcode("P61109A"), {
    code: "P61109A",
    page: null,
    total: null,
  });
  assert.deepEqual(parseBarcode("P71980RA"), {
    code: "P71980RA",
    page: null,
    total: null,
  });
  assert.deepEqual(parseBarcode("P72868RRA"), {
    code: "P72868RRA",
    page: null,
    total: null,
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
  for (const invalid of [
    "",
    null,
    "12345",
    "76186A0628",
    "P76186A0028",
    "P76186A2928",
    "P79710A0",
    "P79710A06",
    "P79710A0020",
    "P79710A9920",
    "P79710A0600",
    "P79710A100120",
    "P79710A-0620",
    "not a barcode",
  ]) {
    assert.equal(parseBarcode(invalid), null, `expected null for ${String(invalid)}`);
    assert.equal(normalizeBarcode(invalid), null, `expected null normalizeBarcode for ${String(invalid)}`);
  }
});

test("cleanBarcode preserves full cleaned barcode while normalizeBarcode extracts only base code", () => {
  assert.equal(cleanBarcode(" p79710a 06*20 "), "P79710A0620");
  assert.equal(cleanBarcode("*p79710a 012*20*"), "P79710A01220");
  assert.equal(cleanBarcode("not a barcode"), "NOTABARCODE");
  assert.equal(cleanBarcode(null), "");
  assert.equal(normalizeBarcode("P79710A0620"), "P79710A");
  assert.equal(normalizeBarcode("P79710A01220"), "P79710A");
});

test("buildPdfPageUrl encodes raw spaces without double-encoding %20 and appends #page=N", () => {
  assert.equal(
    buildPdfPageUrl("https://archive.paperlords.org/library/IAL/Business/June 2026/IAL_BUSINESS_2026_June_U4_QP_1787722754660.pdf", 6),
    "https://archive.paperlords.org/library/IAL/Business/June%202026/IAL_BUSINESS_2026_June_U4_QP_1787722754660.pdf#page=6",
  );
  assert.equal(
    buildPdfPageUrl("https://archive.paperlords.org/library/IAL/Accounting/Jan%202020/paper.pdf", 12),
    "https://archive.paperlords.org/library/IAL/Accounting/Jan%202020/paper.pdf#page=12",
  );
  assert.equal(
    buildPdfPageUrl("https://archive.paperlords.org/library/IAL/Accounting/Jan%202020/paper.pdf#page=3", null),
    "https://archive.paperlords.org/library/IAL/Accounting/Jan%202020/paper.pdf",
  );
});

test("prepareScanResultTarget preserves full barcodes for navigation and retains cleaned malformed input", () => {
  assert.deepEqual(
    prepareScanResultTarget(" p79710a 06*20 ", "https://example.com/paperscan/index.html"),
    {
      barcode: { code: "P79710A", page: 6, total: 20 },
      cleaned: "P79710A0620",
      resultHref: "https://example.com/paperscan/result.html?barcode=P79710A0620",
    },
  );
  assert.deepEqual(
    prepareScanResultTarget("P79710A01220", "https://example.com/paperscan/index.html"),
    {
      barcode: { code: "P79710A", page: 12, total: 20 },
      cleaned: "P79710A01220",
      resultHref: "https://example.com/paperscan/result.html?barcode=P79710A01220",
    },
  );
  assert.deepEqual(
    prepareScanResultTarget("p79710a0020", "https://example.com/paperscan/index.html"),
    {
      barcode: null,
      cleaned: "P79710A0020",
      resultHref: null,
    },
  );
});

test("App.tsx uses prepareScanResultTarget and cleanBarcode instead of normalizeBarcode", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(appSource, /prepareScanResultTarget\(raw,\s*window\.location\.href\)/);
  assert.match(appSource, /cleanBarcode\(text\)\.slice\(0,\s*30\)/);
  assert.equal(appSource.includes("normalizeBarcode("), false);
});
