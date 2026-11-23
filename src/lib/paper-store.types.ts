export interface StoredScan {
  barcode: string;
  code: string;
  page: number | null;
  total: number | null;
  scannedAt: number;
}

export interface PaperScanState {
  version: 1;
  history: StoredScan[];
  favorites: string[];
  feedback: { sound: boolean; vibration: boolean };
}

export interface PaperScanWrite {
  state: PaperScanState;
  persisted: boolean;
}

export interface ParsedScan {
  code: string;
  page: number | null;
  total: number | null;
}

export interface PaperScanStoreApi {
  key: string;
  get(): PaperScanState;
  normalizeBarcode(value: string): string;
  parseBarcode(value: string): ParsedScan | null;
  recordScan(barcode: string, parsed: ParsedScan, scannedAt?: number): PaperScanWrite;
  toggleFavorite(code: string): PaperScanWrite & { active: boolean };
  isFavorite(code: string): boolean;
  setFeedback(patch: Partial<PaperScanState["feedback"]>): PaperScanWrite;
  clearHistory(): PaperScanWrite;
}

declare global {
  interface Window { PaperScanStore: PaperScanStoreApi; }
}
