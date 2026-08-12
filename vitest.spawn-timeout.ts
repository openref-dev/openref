/**
 * The timeout a test declares when its cost is a child process rather than its assertion.
 *
 * F25, SECOND PART, DECIDED BY THE MAINTAINER ON 2026-08-11. The first part made a timeout under
 * the coverage gate legible without moving any bound, and it was right about the bound it refused
 * to move: vitest's five second default protects every ordinary case, and raising it globally
 * would convert a real signal about how much work a case does into permanent silence.
 *
 * WHAT THE FIRST PART DID NOT COVER IS THE CLASS THIS FILE NAMES. A case that boots a NestJS
 * application in a spawned node, packs a tarball with npm, compiles a fixture with tsc or cruises
 * a probe tree with depcruise is not doing the work the default was chosen for. Its duration is
 * set by disk, by the module graph and by whatever else the machine is running, and none of that
 * is a property of the subject under test. `source-links.spec.ts` failing one run in three on an
 * unchanged commit is not a signal about the product; it is a signal that the budget is wrong for
 * that class of case.
 *
 * SO THE DEFAULT STAYS WHERE IT IS AND THESE CASES DECLARE THEIR OWN, per test, at the call site,
 * pointing here for the reason. A timeout firing in an ordinary case therefore still means what it
 * used to mean, which is the property the global raise would have destroyed.
 *
 * THE NUMBER IS A HANG DETECTOR AND NOT A PERFORMANCE BUDGET. Nothing in this class is expected
 * to come near it, and nothing should be tuned against it: a case that takes forty seconds because
 * it spawns eleven processes is answered by spawning one, which is what F25's first part did to
 * two files, not by reading this constant as headroom that has been granted.
 *
 * IT IS ONE NUMBER FOR THE WHOLE CLASS, TAKEN FROM ITS HEAVIEST MEMBER, AND THAT MEMBER ALREADY
 * CARRIED IT. Three cases in `format-allowlist.spec.ts` and one hook in
 * `packaged-attribution.spec.ts` had bare literals of 120000 and 180000 sitting on them with the
 * reason written nowhere, which is this rule being followed by hand and not being findable. The
 * constant is the largest of them, so adopting it lowers no bound that somebody had already found
 * they needed. A per case number would invite exactly the tuning the paragraph above refuses, and
 * a reader meeting this name at a call site can find out in one hop what it is for.
 */

/** What a case whose cost is a spawned process declares, per F25. */
export const SPAWNED_PROCESS_TIMEOUT_MS = 180_000;
