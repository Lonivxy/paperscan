export function parseBarcode(raw: string): {
  code: string;
  page: number | null;
  total: number | null;
} | null;

export function normalizeBarcode(raw: string): string | null;
