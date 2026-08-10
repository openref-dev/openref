/**
 * Loads the published package on the Node version `engines` declares as the floor.
 *
 * WHY THIS IS NOT A VITEST TEST. It has to run on the floor itself, and nothing else in this
 * repository does: vitest, vite and pnpm all require a newer Node than the floor. So this is
 * plain ESM with no dependencies, it spawns the runtime it is already running on, and it is
 * invoked in CI by a step that has swapped the Node version underneath it.
 *
 * WHY IT EXISTS AT ALL. `@openref/nest` ships ESM and CommonJS, and SPEC 23 says
 * `ERR_REQUIRE_ESM` in a consumer project is inadmissible. Native `require(esm)` arrived in
 * Node 20.19, so a check that runs on a current runtime passes whether or not anything was done
 * about it, while the reader it protects is on an older one. A compatibility test that cannot
 * fail on the version it protects reports coverage that does not exist.
 *
 * It reads the floor out of `engines` rather than carrying a copy, so the two cannot drift.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The two consumer projects, one per module system.
 *
 * Real projects that declare `@openref/nest`, because only such a project can resolve it. The
 * CommonJS one is the NestJS 10 arm of the compatibility matrix, which is the shape a NestJS
 * application scaffolded by the CLI has.
 */
const CONSUMERS = [
  { kind: 'module', directory: join(repoRoot, 'examples', 'nest-minimal') },
  { kind: 'commonjs', directory: join(repoRoot, 'compat', 'nest10-cjs') },
];

const LOAD = {
  module:
    "const m = await import('@openref/nest'); if (typeof m.OpenRefModule.setup !== 'function') throw new Error('the module loaded but does not carry OpenRefModule.setup'); console.log('ok');",
  commonjs:
    "const m = require('@openref/nest'); if (typeof m.OpenRefModule.setup !== 'function') throw new Error('the module loaded but does not carry OpenRefModule.setup'); console.log('ok');",
};

/**
 * The lowest Node version this repository claims to support.
 *
 * @returns The floor, such as `20.11.0`
 */
export function declaredFloor() {
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const range = manifest.engines?.node ?? '';
  const match = /(\d+\.\d+\.\d+)/.exec(range);

  if (match === null) {
    throw new Error(`engines.node in the root package.json is "${range}", which names no floor`);
  }

  return match[1];
}

/**
 * Compares two dotted versions.
 *
 * @param {string} left - A version
 * @param {string} right - Another version
 * @returns {number} Negative when left is lower
 */
function compareVersions(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);

  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }

  return 0;
}

/**
 * Loads the package in one consumer, on the Node running this script.
 *
 * @param {{kind: 'module' | 'commonjs', directory: string}} consumer - Where and how
 * @returns {{ok: boolean, detail: string}} What happened
 */
function load(consumer) {
  try {
    execFileSync(process.execPath, [`--input-type=${consumer.kind}`, '-e', LOAD[consumer.kind]], {
      cwd: consumer.directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    return { ok: true, detail: 'loaded' };
  } catch (cause) {
    const output = `${cause.stdout ?? ''}${cause.stderr ?? ''}`;
    const code = /\b(ERR_[A-Z_]+)\b/.exec(output)?.[1] ?? 'failed';
    const first = output.split('\n').find((line) => line.includes('Error')) ?? '';

    return { ok: false, detail: `${code}: ${first.trim().slice(0, 200)}` };
  }
}

const floor = declaredFloor();
const running = process.versions.node;

console.log(`engines floor ${floor}, running on ${running}`);

if (compareVersions(running, floor) !== 0) {
  console.log(
    `WARNING: this is not the floor. Run it on ${floor} or the check says nothing about the version it protects.`,
  );
}

let failed = false;

for (const consumer of CONSUMERS) {
  const result = load(consumer);
  if (!result.ok) failed = true;
  console.log(`  ${result.ok ? 'PASS' : 'FAIL'} ${consumer.kind.padEnd(9)} ${result.detail}`);
}

if (failed) {
  console.log(
    `\n@openref/nest does not load on Node ${running}, which is inside the range engines declares.`,
  );
  console.log('Either the code is wrong or the declared floor is. Do not change the floor to');
  console.log('make this pass without deciding that dropping those readers is what you want.');
  process.exitCode = 1;
}
