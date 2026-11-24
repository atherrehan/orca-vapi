// At most `max` tasks run at once; the rest wait in order. A finishing task hands its slot
// straight to the next waiter, so the limit is never exceeded.
export class Limiter {
  readonly #max: number
  #active = 0
  readonly #waiting: (() => void)[] = []

  constructor(max: number) {
    this.#max = Math.max(1, max)
  }

  get active(): number {
    return this.#active
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.#active < this.#max) this.#active++
    else await new Promise<void>((resolve) => this.#waiting.push(resolve))
    try {
      return await task()
    } finally {
      const next = this.#waiting.shift()
      if (next) next()
      else this.#active--
    }
  }
}
