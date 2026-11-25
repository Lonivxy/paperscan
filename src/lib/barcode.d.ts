export interface ParsedBarcode {
  code: string;
  page: number | null;
  total: number | null;
}

export interface ScanResultTarget {
  barcode: ParsedBarcode | null;
  cleaned: string;
  resultHref: string | null;
}

export function cleanBarcode(raw: string | null | undefined): string;

export function parseBarcode(raw: string | null | undefined): ParsedBarcode | null;

export function normalizeBarcode(raw: string | null | undefined): string | null;

export function buildPdfPageUrl(rawUrl: string, page?: number | null): string;

export function prepareScanResultTarget(raw: string | null | undefined, baseHref?: string): ScanResultTarget;
