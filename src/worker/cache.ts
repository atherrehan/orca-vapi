// A short-lived in-memory cache. Nothing from Vapi is ever written to disk; the cache is lost when
// the worker stops and cleared on disconnect and refresh.
export class TtlCache<T> {
  readonly #ttlMs: number
  readonly #now: () => number
  readonly #entries = new Map<string, { at: number; value: T }>()

  constructor(ttlMs: number, now: () => number = Date.now) {
    this.#ttlMs = ttlMs
    this.#now = now
  }

  get(key: string): T | undefined {
    const entry = this.#entries.get(key)
    if (!entry) return undefined
    if (this.#now() - entry.at > this.#ttlMs) {
      this.#entries.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: string, value: T): void {
    this.#entries.set(key, { at: this.#now(), value })
  }

  delete(key: string): void {
    this.#entries.delete(key)
  }

  clear(): void {
    this.#entries.clear()
  }

  get size(): number {
    return this.#entries.size
  }
}
