import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = resolve(root, "public", "papers.json");
const codePattern = /^P\d{5,7}[A-Z]{1,3}$/;
const ignoredStatuses = new Set([401, 403, 429]);

export function validatePaperIndex(index) {
  const errors = [];
  if (!index || !Array.isArray(index.papers)) return ["Index must contain a papers array."];
  if (!Array.isArray(index.subjects)) errors.push("Index must contain a subjects array.");
  else if (index.subjects.length === 0) errors.push("Index must list at least one subject.");
  if (typeof index.updated !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(index.updated)) {
    errors.push("Index updated must be a YYYY-MM-DD date.");
  }

  const seenCodes = new Set();
  const knownSubjects = new Set(index.subjects ?? []);
  for (const [position, paper] of index.papers.entries()) {
    const where = `papers[${position}]`;
    if (!paper || typeof paper !== "object") {
      errors.push(`${where} must be an object.`);
      continue;
    }
    for (const field of ["code", "qualification", "subject", "unit", "name", "session"]) {
      if (typeof paper[field] !== "string" || !paper[field].trim()) errors.push(`${where}.${field} is required.`);
    }
    if (typeof paper.code === "string") {
      if (!codePattern.test(paper.code)) errors.push(`${where}.code has an invalid publication code: ${paper.code}`);
      if (seenCodes.has(paper.code)) errors.push(`Duplicate publication code: ${paper.code}`);
      seenCodes.add(paper.code);
    }
    if (paper.qualification && paper.subject && knownSubjects.size && !knownSubjects.has(`${paper.qualification} · ${paper.subject}`)) {
      errors.push(`${where} is missing from the subjects list: ${paper.qualification} · ${paper.subject}`);
    }
    const hasResource = ["qp", "ms"].some((field) => typeof paper[field] === "string" && paper[field].trim());
    if (!hasResource) errors.push(`${where} must have at least one available PDF link.`);
    for (const field of ["qp", "ms"]) {
      if (paper[field] == null || paper[field] === "") continue;
      if (typeof paper[field] !== "string") {
        errors.push(`${where}.${field} must be a URL string when provided.`);
        continue;
      }
      try {
        const url = new URL(paper[field]);
        if (url.protocol !== "https:" || !url.pathname.toLowerCase().endsWith(".pdf")) {
          errors.push(`${where}.${field} must be an HTTPS PDF URL.`);
        }
      } catch {
        errors.push(`${where}.${field} is not a valid URL.`);
      }
    }
  }
  return errors;
}

function classifyStatus(status) {
  if (status >= 200 && status < 400) return "ok";
  if (ignoredStatuses.has(status)) return "inconclusive";
  if (status === 404 || status === 410) return "broken";
  if (status >= 500) return "retry";
  return "broken";
}

export async function checkPdfUrl(url, {
  fetchImpl = fetch,
  retries = 1,
  timeoutMs = 7000,
} = {}) {
  let lastStatus = null;
  let lastError = "";
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const init = {
        method: "HEAD",
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "User-Agent": "PaperScan-Paper-Link-Check/1.0" },
      };
      let response = await fetchImpl(url, init);
      if (response.status === 405 || response.status === 501) {
        response = await fetchImpl(url, {
          ...init,
          method: "GET",
          headers: { ...init.headers, Range: "bytes=0-0" },
        });
      }
      lastStatus = response.status;
      const classification = classifyStatus(response.status);
      if (classification !== "retry" || attempt === retries) {
        return { url, status: response.status, result: classification === "retry" ? "inconclusive" : classification };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt === retries) return { url, status: lastStatus, result: "inconclusive", error: lastError };
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 350 * (attempt + 1)));
  }
  return { url, status: lastStatus, result: "inconclusive", error: lastError };
}

async function mapConcurrent(values, concurrency, worker) {
  const results = new Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(values[index]);
    }
  }));
  return results;
}

async function loadIndex() {
  return JSON.parse(await readFile(indexPath, "utf8"));
}

export async function runValidation({ links = false, limit = Infinity } = {}) {
  const index = await loadIndex();
  const errors = validatePaperIndex(index);
  if (errors.length) {
    for (const error of errors) console.error(`ERROR ${error}`);
    return 1;
  }
  console.log(`Paper index is valid: ${index.papers.length} papers, ${index.subjects.length} subjects, no duplicate codes.`);
  if (!links) return 0;

  const urls = [...new Set(index.papers.flatMap((paper) => [paper.qp, paper.ms].filter(Boolean)))].slice(0, limit);
  console.log(`Checking ${urls.length} unique PDF links with HEAD requests (GET range fallback where needed).`);
  const results = await mapConcurrent(urls, 16, (url) => checkPdfUrl(url));
  const broken = results.filter((result) => result.result === "broken");
  const inconclusive = results.filter((result) => result.result === "inconclusive");
  console.log(`Link check: ${results.length - broken.length - inconclusive.length} healthy, ${broken.length} broken, ${inconclusive.length} inconclusive.`);
  for (const result of broken) console.error(`BROKEN ${result.status ?? "network"} ${result.url}`);
  for (const result of inconclusive) console.warn(`UNVERIFIED ${result.status ?? result.error ?? "unknown"} ${result.url}`);
  return broken.length ? 1 : 0;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  const limitArg = process.argv.find((argument) => argument.startsWith("--limit="));
  let limit = Infinity;
  if (limitArg) {
    const parsed = Number.parseInt(limitArg.slice("--limit=".length), 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      console.error("ERROR --limit must be a positive integer.");
      process.exitCode = 2;
    } else {
      limit = parsed;
    }
  }
  if (process.exitCode !== 2) {
    const exitCode = await runValidation({ links: process.argv.includes("--links"), limit });
    process.exitCode = exitCode;
  }
}
