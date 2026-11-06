// Best-effort optimization for sequential requests on a warm server. Durable
// processing state and source files always remain in Supabase. Callers must
// authorize the owner/assignment before lookup and verify SHA-256 before put.
export class ScanSourceCache {
  private entries = new Map<string, { bytes: Buffer; touched: number }>();
  private size = 0;
  private maxBytes: number;
  private ttlMs: number;
  constructor(maxBytes = 64 * 1024 * 1024, ttlMs = 10 * 60_000) {
    this.maxBytes = maxBytes;
    this.ttlMs = ttlMs;
  }
  get(key: string, now = Date.now()) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.size -= entry.bytes.length;
    if (now - entry.touched > this.ttlMs) return undefined;
    entry.touched = now;
    this.entries.set(key, entry);
    this.size += entry.bytes.length;
    return entry.bytes;
  }
  put(key: string, bytes: Buffer, now = Date.now()) {
    const old = this.entries.get(key);
    if (old) {
      this.entries.delete(key);
      this.size -= old.bytes.length;
    }
    if (bytes.length > this.maxBytes) return;
    while (this.size + bytes.length > this.maxBytes || this.entries.size >= 3) {
      const first = this.entries.entries().next().value;
      if (!first) break;
      this.entries.delete(first[0]);
      this.size -= first[1].bytes.length;
    }
    this.entries.set(key, { bytes, touched: now });
    this.size += bytes.length;
  }
}
