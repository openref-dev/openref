/**
 * SPEC 13.3's reader page list and the `PageKind` union, read out of the two files that state them.
 *
 * THE TWO READERS LIVE HERE RATHER THAN IN THE GATE because the projection generator needs the
 * first of them, and a lib that imported a gate would invert the direction every other file in
 * this package runs in. The gate re-exports both, so the cases that pin their behaviour keep
 * naming the module a reader would look in.
 */

import { READER_PAGES_PREFIX } from '../config.js';

/**
 * The routes SPEC 13.3 lists as reader pages, read out of the specification's own line.
 *
 * THE LINE IS FOUND BY ITS PREFIX AND THE ENTRIES BY THEIR BACKTICKS, which is how the document
 * writes them: one line, a Russian label, then the routes separated by a middle dot and each one
 * in code. Reading the backticked spans rather than splitting on the separator is what keeps a
 * changed separator from silently producing one long entry that matches nothing.
 *
 * @param spec - Full text of `ai-docs/SPEC.md`
 * @returns The routes, or null when section 13.3 or its reader page line is absent
 */
export function readerPagesOf(spec: string): string[] | null {
  const section = /^### 13\.3\. /m.exec(spec);
  if (section === null) return null;

  const rest = spec.slice(section.index);
  const end = /^#{2,3} \d+/m.exec(rest.slice(section[0].length));
  const body = end === null ? rest : rest.slice(0, section[0].length + end.index);

  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(READER_PAGES_PREFIX)) continue;

    const routes = [...trimmed.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? '');
    return routes.filter((route) => route !== '');
  }

  return null;
}

/**
 * The members of the `PageKind` union, read out of its declaration.
 *
 * @param source - Full text of the file that declares it
 * @returns The members, or null when the declaration is not there to read
 */
export function pageKindsOf(source: string): string[] | null {
  const declaration = /export type PageKind =([^;]*);/.exec(source);
  if (declaration === null) return null;

  const members = [...(declaration[1] ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1] ?? '');
  return members.length === 0 ? null : members;
}
