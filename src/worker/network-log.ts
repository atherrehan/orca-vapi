// A small in-memory record of recent requests for the panel's "Network activity" view. It keeps
// method, path, query parameter names, status and timing only: never query values, headers or
// bodies.
import type { NetworkEntry } from '../shared/protocol.ts'

export class NetworkLog {
  readonly #limit: number
  #entries: NetworkEntry[] = []

  constructor(limit = 50) {
    this.#limit = Math.max(1, limit)
  }

  add(entry: NetworkEntry): void {
    this.#entries.push(entry)
    if (this.#entries.length > this.#limit) this.#entries.shift()
  }

  /** Newest first, as copies. */
  recent(): NetworkEntry[] {
    return this.#entries.map((entry) => ({ ...entry, queryKeys: [...entry.queryKeys] })).reverse()
  }

  clear(): void {
    this.#entries = []
  }
}
