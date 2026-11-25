export function cleanBarcode(raw) {
  return String(raw ?? "").toUpperCase().replace(/[\s*]/g, "");
}

export function parseBarcode(raw) {
  const value = cleanBarcode(raw);
  const match = /^(P\d{5,7}[A-Z]{1,3})(\d*)$/.exec(value);
  if (!match) return null;

  const suffix = match[2];
  if (!suffix) return { code: match[1], page: null, total: null };
  if (suffix.length < 3) return null;

  const page = Number.parseInt(suffix.slice(0, -2), 10);
  const total = Number.parseInt(suffix.slice(-2), 10);
  return page > 0 && page <= total ? { code: match[1], page, total } : null;
}

export function normalizeBarcode(raw) {
  return parseBarcode(raw)?.code ?? null;
}

export function buildPdfPageUrl(rawUrl, page = null) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return "";
  const fragment = Number.isInteger(page) && page > 0 ? `page=${page}` : "";
  try {
    const url = new URL(rawUrl);
    url.hash = fragment;
    return url.href;
  } catch {
    const base = rawUrl.split("#")[0];
    return fragment ? `${base}#${fragment}` : base;
  }
}

export function prepareScanResultTarget(raw, baseHref = "https://paperscan.local/") {
  const barcode = parseBarcode(raw);
  const cleaned = cleanBarcode(raw).slice(0, 30);
  if (!barcode) {
    return { barcode: null, cleaned, resultHref: null };
  }
  const resultUrl = new URL("result.html", baseHref);
  resultUrl.searchParams.set("barcode", cleaned);
  return { barcode, cleaned, resultHref: resultUrl.href };
}
