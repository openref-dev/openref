/**
 * Naming the machine a figure came from.
 *
 * A throttled measurement is relative to the host CPU, so a figure without a machine attached
 * is a number nobody can compare with another number. The baseline is therefore keyed on this
 * identity, and a run on a machine the baseline does not know checks the ceiling and says
 * plainly that it has nothing to compare against, rather than comparing anyway.
 */

import { arch, cpus, platform, totalmem } from 'node:os';

/** Where a measurement was taken. */
export interface MeasurementEnvironment {
  /** Stable key the baseline is stored under. */
  readonly id: string;
  /** Human readable, for the record. */
  readonly label: string;
  readonly cpuModel: string;
  readonly cpuCount: number;
  readonly totalMemoryBytes: number;
}

/**
 * Identifies the current machine.
 *
 * A GitHub runner is named by its image rather than by its hardware, because that is what
 * changes underneath a budget and what a maintainer can act on. Anything else is `local`,
 * qualified by platform and architecture, which is enough to keep two developers' figures from
 * being filed under one name.
 *
 * @returns The identity
 */
export function currentEnvironment(): MeasurementEnvironment {
  const processors = cpus();
  const cpuModel = processors[0]?.model ?? 'unknown';

  const shared = {
    cpuModel,
    cpuCount: processors.length,
    totalMemoryBytes: totalmem(),
  };

  if (process.env.GITHUB_ACTIONS === 'true') {
    const image = process.env.ImageOS ?? 'unknown-image';
    const architecture = process.env.RUNNER_ARCH ?? arch();
    return {
      id: `github-actions/${image}/${architecture}`,
      label: `GitHub Actions runner, image ${image}, ${architecture}`,
      ...shared,
    };
  }

  return {
    id: `local/${platform()}/${arch()}`,
    label: `local machine, ${platform()} ${arch()}`,
    ...shared,
  };
}
