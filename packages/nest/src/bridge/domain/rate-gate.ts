/**
 * The `maxMessagesPerSecond` half of SPEC 14.8, as a token bucket over an injected clock.
 *
 * A BUCKET AND NOT A FIXED WINDOW, because a fixed window lets a producer send a whole window's
 * allowance at the end of one window and the next window's at the start of the next, which is
 * twice the stated rate arriving back to back and a limiter that is wrong exactly when a burst
 * happens. The bucket refills continuously, so the long run rate is the stated one and there is no
 * edge to sit on.
 *
 * IT STARTS FULL, AND THAT IS ONE SECOND OF BURST DELIBERATELY GRANTED. Starting empty makes the
 * first message of every subscription wait out one interval for no benefit a reader can name; a
 * bucket that starts full delivers it at once. What that costs is written down rather than left to
 * be discovered: over `s` seconds a subscription may see up to `rate * (s + 1)` messages, and the
 * suites assert that ceiling rather than `rate * s`.
 *
 * THE CLOCK IS INJECTED so a test measures the rule instead of waiting for it, which is the same
 * arrangement the proxy of SPEC 14.5 and the remote lifecycle of SPEC 15.2 use.
 */

/** Hands out permission to send, at a bounded long run rate. */
export class RateGate {
  private tokens: number;

  private last: number;

  /**
   * @param perSecond - Messages a second this gate allows
   * @param now - The clock, in milliseconds
   */
  constructor(
    private readonly perSecond: number,
    private readonly now: () => number,
  ) {
    this.tokens = perSecond;
    this.last = now();
  }

  /**
   * How many messages may be sent at this instant.
   *
   * @returns A whole number of messages, zero when the bucket is dry
   */
  available(): number {
    const at = this.now();
    const elapsed = Math.max(0, at - this.last);

    this.last = at;
    this.tokens = Math.min(this.perSecond, this.tokens + (elapsed * this.perSecond) / 1000);

    return Math.floor(this.tokens);
  }

  /**
   * Records that messages were sent.
   *
   * @param count - How many
   */
  spend(count: number): void {
    this.tokens = Math.max(0, this.tokens - count);
  }

  /**
   * How long until at least one message may be sent.
   *
   * @returns Milliseconds to wait, at least one so a timer cannot become a hot loop
   */
  waitMs(): number {
    if (this.tokens >= 1) return 1;

    return Math.max(1, Math.ceil(((1 - this.tokens) * 1000) / this.perSecond));
  }
}
