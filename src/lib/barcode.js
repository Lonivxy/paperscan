export function parseBarcode(raw) {
  const value = String(raw ?? "").toUpperCase().replace(/[\s*]/g, "");
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
