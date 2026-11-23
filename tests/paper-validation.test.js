import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkPdfUrl, validatePaperIndex } from "../tools/validate-papers.mjs";

const index = JSON.parse(await readFile(new URL("../public/papers.json", import.meta.url), "utf8"));

test("the checked-in paper index has unique codes and valid PDF links", () => {
  assert.deepEqual(validatePaperIndex(index), []);
});

test("paper validation catches duplicate codes and malformed links", () => {
  const sample = {
    updated: "2026-10-26",
    subjects: ["IAL · Biology"],
    papers: [
      { code: "P76186A", qualification: "IAL", subject: "Biology", unit: "U1", name: "Biology U1", session: "Jan 2026", qp: "https://papers.example/qp.pdf" },
      { code: "P76186A", qualification: "IAL", subject: "Biology", unit: "U1", name: "Biology U1", session: "Jan 2026", qp: "http://papers.example/qp" },
    ],
  };
  assert.match(validatePaperIndex(sample).join("\n"), /Duplicate publication code/);
  assert.match(validatePaperIndex(sample).join("\n"), /must be an HTTPS PDF URL/);
});

test("paper validation permits unavailable document links when one resource remains", () => {
  const sample = {
    updated: "2026-10-26",
    subjects: ["IAL · Biology"],
    papers: [
      { code: "P76186A", qualification: "IAL", subject: "Biology", unit: "U1", name: "Biology U1", session: "Jan 2026", qp: null, ms: "https://papers.example/ms.pdf" },
    ],
  };
  assert.deepEqual(validatePaperIndex(sample), []);
  sample.papers[0].ms = null;
  assert.match(validatePaperIndex(sample).join("\n"), /at least one available PDF link/);
});

test("link checker falls back to a ranged GET when HEAD is unsupported", async () => {
  const methods = [];
  const result = await checkPdfUrl("https://papers.example/qp.pdf", {
    fetchImpl: async (_url, init) => {
      methods.push(init.method);
      return { status: init.method === "HEAD" ? 405 : 206 };
    },
  });
  assert.deepEqual(methods, ["HEAD", "GET"]);
  assert.equal(result.result, "ok");
});

test("paper validation rejects an empty subject list", () => {
  const sample = { updated: "2026-10-26", subjects: [], papers: [] };
  assert.match(validatePaperIndex(sample).join("\n"), /at least one subject/);
});

test("a malformed link-check limit exits instead of checking zero links", () => {
  const result = spawnSync(
    process.execPath,
    ["tools/validate-papers.mjs", "--links", "--limit=nope"],
    { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8" },
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--limit must be a positive integer/);
});

test("confirmed missing links are distinguished from temporary access limits", async () => {
  const missing = await checkPdfUrl("https://papers.example/missing.pdf", {
    fetchImpl: async () => ({ status: 404 }),
  });
  const limited = await checkPdfUrl("https://papers.example/private.pdf", {
    fetchImpl: async () => ({ status: 403 }),
  });
  assert.equal(missing.result, "broken");
  assert.equal(limited.result, "inconclusive");
});
