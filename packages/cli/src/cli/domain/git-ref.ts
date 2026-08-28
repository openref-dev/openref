/**
 * What may be handed to git, and how a path is spelled inside a revision.
 *
 * BOTH HALVES ARE PURE AND BOTH ARE USED ON TWO SIDES OF THE BOUNDARY, which is why they are
 * here rather than in the adapter that runs git: the side resolution of SPEC 17.1 refuses a bad
 * argument before it decides anything, and the adapter refuses it again before it spawns. A guard
 * that lives in the thing it guards can only run after the decision it was supposed to inform.
 */

/**
 * Why an argument may not be handed to git, or undefined when it may.
 *
 * INJECTION IS NOT THE HAZARD HERE AND SAYING SO IS THE POINT. Arguments reach git as an array
 * and never through a shell, so no quoting, no substitution and no metacharacter changes what
 * runs. What is left is that git reads an argument beginning with `-` as an option, and a caller
 * who typed a branch called `-f` would be running a different command than the one they wrote.
 *
 * WHICH SPELLINGS ACTUALLY ARRIVE HERE FROM A POSITIONAL, MEASURED RATHER THAN ASSUMED. `parseArgs`
 * routes an argument by its first characters, so the three cases are different and only one of
 * them is this guard's:
 *
 * - one leading hyphen, `openref diff -f main --spec x.json`, is a positional and does reach this
 *   guard, which refuses it by name. Both sides of the diff were measured.
 * - two leading hyphens, `openref diff --upload-pack=x main`, never becomes a positional at all:
 *   `parseArgs` reads every `--name` as a flag, so the command sees one positional instead of two
 *   and stops earlier with "two spec paths or git refs are required". A ref genuinely called
 *   `--upload-pack=x` is therefore not expressible, which is the deliberate cost of `--` meaning
 *   flag, and this guard cannot be made reachable for it without giving that meaning up.
 * - `-h` alone is read as `--help` and prints usage, for the same reason.
 *
 * The guard is also reached only once a path is known: a bare side with no `--spec` and no file on
 * the other side fails first with the message about not knowing which file to read.
 *
 * @param value - A ref or a path taken from the command line
 * @param what - What the value is, for the message
 * @returns The refusal, or undefined
 */
export function refusedGitArgument(value: string, what: string): string | undefined {
  if (value === '') return `${what} is empty`;
  if (value.startsWith('-')) {
    return `${what} "${value}" starts with "-", which git would read as an option, not as a name`;
  }
  return undefined;
}

/**
 * The `<rev>:<path>` argument `git show` takes, with the path anchored to the caller's directory.
 *
 * `git show <rev>:<path>` reads from the top of the work tree and `git show <rev>:./<path>` reads
 * from the current directory, which is where the file side of the same diff reads its own. A diff
 * whose two sides disagreed about what `openapi.json` means would be the worst kind of wrong: it
 * would produce a report rather than an error.
 *
 * @param ref - The revision
 * @param path - The path, relative to the caller's directory
 * @returns The single argument
 */
export function gitObjectArgument(ref: string, path: string): string {
  const anchored = path.startsWith('./') || path.startsWith('../') ? path : `./${path}`;
  return `${ref}:${anchored}`;
}
