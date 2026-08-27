import type { IRDocument } from '@openref/core';

/** One line naming what was loaded, honest about being a load confirmation and nothing more. */
export function describeDocument(document: IRDocument): string {
  const count = document.nodes.size;
  return `${document.info.title} ${document.info.version}: ${String(count)} node${count === 1 ? '' : 's'} loaded`;
}
