interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache {
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private readonly maxEntries: number;

  constructor(maxEntries = 250) {
    this.maxEntries = maxEntries;
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  async getOrCompute<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) {
      return cached;
    }
    const fresh = await compute();
    this.set(key, fresh, ttlMs);
    return fresh;
  }

  clear(): void {
    this.store.clear();
  }
}
