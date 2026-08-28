import { Node, Project, ScriptTarget, SyntaxKind } from 'ts-morph';
import type { FixSkipReason, PlannedEdit } from '../../domain/fix-plan';
import type { ClassDeclaration, Decorator, MethodDeclaration, SourceFile } from 'ts-morph';

/**
 * The rewriter of SPEC 17: it reads a TypeScript syntax tree and writes plain text at offsets.
 *
 * THE TREE IS READ AND NEVER PRINTED, AND THAT IS THE FORMAT PRESERVATION. A printer reproduces
 * the node it changed from its own idea of how source looks, so the one statement a reviewer most
 * needs to read is the one that comes back reindented, requoted or reflowed. Here the tree answers
 * one question, which is where a byte goes, and every edit is an insertion into the original
 * string. Nothing is ever removed, so every byte outside an insertion is byte identical by
 * construction rather than by care, which is what lets a test assert it instead of a reviewer.
 *
 * `ts-morph` IS THE COMPILER API WITH A NAVIGABLE TREE ON TOP, not a second parser. The rewriter
 * therefore reads the same syntax the project's own `tsc` reads, and a construct this file cannot
 * account for is a construct that refuses rather than one that is misread.
 *
 * EVERYTHING HERE IS PURE OVER A STRING. The file is read and written by the service; this decides
 * what the new text would be. `--dry-run` and `--fix` call the same function and differ in one
 * boolean afterwards, which is how SPEC 7.4's requirement that they show the same edits is a
 * property of the structure rather than a promise in a comment.
 */

/** One edit the tree refused, with the reason it refused. */
export interface RefusedEdit {
  readonly edit: PlannedEdit;
  readonly reason: FixSkipReason;
  readonly detail: string;
}

/** What rewriting one file would produce. */
export interface FileRewrite {
  /** The new text, identical to the input when nothing was applied. */
  readonly text: string;
  readonly applied: readonly PlannedEdit[];
  readonly refused: readonly RefusedEdit[];
}

/** The module every decorator this tool writes comes from. */
const SWAGGER_MODULE = '@nestjs/swagger';

/**
 * The status each `@nestjs/swagger` response shorthand documents.
 *
 * A TABLE OF A LIBRARY'S OWN NAMES, WHICH IS A FACT AND NOT A GUESS. It exists so that a handler
 * carrying `@ApiTooManyRequestsResponse()` is seen to document 429 by a tool looking for a literal
 * `status`. A name that looks like a response decorator and is not in this table stops the edit,
 * because an unknown one may document exactly the status about to be added and this file has no
 * way to find out.
 */
const RESPONSE_SHORTHANDS: Readonly<Record<string, number>> = {
  ApiOkResponse: 200,
  ApiCreatedResponse: 201,
  ApiAcceptedResponse: 202,
  ApiNoContentResponse: 204,
  ApiMovedPermanentlyResponse: 301,
  ApiFoundResponse: 302,
  ApiBadRequestResponse: 400,
  ApiUnauthorizedResponse: 401,
  ApiPaymentRequiredResponse: 402,
  ApiForbiddenResponse: 403,
  ApiNotFoundResponse: 404,
  ApiMethodNotAllowedResponse: 405,
  ApiNotAcceptableResponse: 406,
  ApiRequestTimeoutResponse: 408,
  ApiConflictResponse: 409,
  ApiGoneResponse: 410,
  ApiPreconditionFailedResponse: 412,
  ApiPayloadTooLargeResponse: 413,
  ApiUriTooLongResponse: 414,
  ApiUnsupportedMediaTypeResponse: 415,
  ApiUnprocessableEntityResponse: 422,
  ApiTooManyRequestsResponse: 429,
  ApiInternalServerErrorResponse: 500,
  ApiNotImplementedResponse: 501,
  ApiBadGatewayResponse: 502,
  ApiServiceUnavailableResponse: 503,
  ApiGatewayTimeoutResponse: 504,
};

/** One insertion into the original text. */
interface Splice {
  readonly pos: number;
  readonly text: string;
  /** Position in the report's order, so two insertions at one offset keep that order. */
  readonly order: number;
}

/** An edit that survived the tree, with where its decorator goes. */
interface Located {
  readonly edit: PlannedEdit;
  readonly pos: number;
  readonly indent: string;
  readonly order: number;
}

/**
 * Rewrites one file's text, applying every edit the tree does not refuse.
 *
 * @param file - Repository relative path, used for messages and for the parser's file name
 * @param text - The file exactly as it is on disk
 * @param edits - The edits planned for this file, in report order
 * @returns The new text and the verdict on every edit
 */
export function rewriteSource(
  file: string,
  text: string,
  edits: readonly PlannedEdit[],
): FileRewrite {
  const project = newProject();
  const source = project.createSourceFile(file, text, { overwrite: true });

  const located: Located[] = [];
  const refused: RefusedEdit[] = [];

  edits.forEach((edit, order) => {
    const outcome = locate(source, text, edit, order);
    if ('detail' in outcome) refused.push(outcome);
    else located.push(outcome);
  });

  const imports = planImport(
    source,
    located.map((entry) => entry.edit.decorator.importName),
  );

  if (imports.kind === 'refused') {
    for (const entry of located) {
      refused.push({ edit: entry.edit, reason: imports.reason, detail: imports.detail });
    }
    return { text, applied: [], refused };
  }

  if (located.length === 0) return { text, applied: [], refused };

  const splices: Splice[] = located.map((entry) => ({
    pos: entry.pos,
    text: `${entry.edit.decorator.text}\n${entry.indent}`,
    order: entry.order,
  }));
  if (imports.splice !== undefined) splices.push(imports.splice);

  const rewritten = applySplices(text, splices);

  // THE RESULT IS PARSED BEFORE IT IS OFFERED, because a rewriter whose output does not compile
  // has done the one thing worse than doing nothing. A file that will not parse loses every edit
  // planned for it rather than some of them: the edits share a text, and there is no way to tell
  // from a syntax error which insertion caused it.
  const syntax = syntaxErrorIn(rewritten, file);
  if (syntax !== undefined) {
    for (const entry of located) {
      refused.push({
        edit: entry.edit,
        reason: 'no-mechanical-edit',
        detail: `the rewritten file did not parse, so nothing was written: ${syntax}`,
      });
    }
    return { text, applied: [], refused };
  }

  return { text: rewritten, applied: located.map((entry) => entry.edit), refused };
}

/** A parser with no filesystem behind it, since every input arrives as a string. */
function newProject(): Project {
  return new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { target: ScriptTarget.ES2022, experimentalDecorators: true },
  });
}

/**
 * The first syntax error in a text, or undefined when it parses.
 *
 * SYNTACTIC ONLY, AND DELIBERATELY. A source file parsed on its own has no `@nestjs/swagger` to
 * resolve and no `reflect-metadata` in scope, so its semantic diagnostics are a list of things
 * that are true of every file read this way. The question here is whether the insertion broke the
 * grammar, and that is the question a syntactic diagnostic answers.
 *
 * @param text - The rewritten text
 * @param file - The file name to parse it under
 * @returns The first message, or undefined
 */
function syntaxErrorIn(text: string, file: string): string | undefined {
  const project = newProject();
  const source = project.createSourceFile(file, text, { overwrite: true });
  const diagnostics = project.getProgram().getSyntacticDiagnostics(source);
  const first = diagnostics[0];
  if (first === undefined) return undefined;

  const message = first.getMessageText();
  return typeof message === 'string' ? message : message.getMessageText();
}

/**
 * Finds where one edit's decorator goes, or says why it cannot go anywhere.
 *
 * @param source - The parsed file
 * @param text - The same file as text, for the line the handler starts on
 * @param edit - The planned edit
 * @param order - Its position in the report's order
 * @returns Where to insert, or the refusal
 */
function locate(
  source: SourceFile,
  text: string,
  edit: PlannedEdit,
  order: number,
): Located | RefusedEdit {
  const declaration = source.getClass(edit.controller);
  if (declaration === undefined) {
    return {
      edit,
      reason: 'no-source-location',
      detail: `${edit.file} declares no class ${edit.controller}, so the finding points at source this run cannot see`,
    };
  }

  const method = methodNamed(declaration, edit.handler);
  if (method === undefined) {
    return {
      edit,
      reason: 'no-source-location',
      detail: `${edit.controller} in ${edit.file} declares no method ${edit.handler}`,
    };
  }

  const existing = conflictingDecorator(declaration, method, edit);
  if (existing !== undefined) {
    return {
      edit,
      reason: 'existing-decorator',
      detail: `${edit.controller}.${edit.handler} already carries ${existing}, and this edit would have to reach inside it rather than sit beside it`,
    };
  }

  const pos = method.getStart();
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  const indent = text.slice(lineStart, pos);
  if (!/^[ \t]*$/.test(indent)) {
    return {
      edit,
      reason: 'no-mechanical-edit',
      detail: `${edit.controller}.${edit.handler} does not begin its own line, so a decorator cannot be placed above it without moving code`,
    };
  }

  return { edit, pos, indent, order };
}

/** The method of a class by name, whether it is an instance method or a static one. */
function methodNamed(declaration: ClassDeclaration, name: string): MethodDeclaration | undefined {
  return declaration.getMethods().find((method) => method.getName() === name);
}

/**
 * The decorator already present that stops an edit, or undefined when none does.
 *
 * THE CLASS IS READ AS WELL AS THE METHOD. A `@nestjs/swagger` decorator on a controller applies
 * to every route in it, so one there is as much an existing assertion as one on the handler.
 *
 * @param declaration - The controller class
 * @param method - The handler
 * @param edit - The planned edit, whose decorator says what would collide with it
 * @returns The name of the offending decorator, or undefined
 */
function conflictingDecorator(
  declaration: ClassDeclaration,
  method: MethodDeclaration,
  edit: PlannedEdit,
): string | undefined {
  const decorators = [...declaration.getDecorators(), ...method.getDecorators()];
  const conflict = edit.decorator.conflictsWith;

  if (conflict.kind === 'any-of') {
    const hit = decorators.find((decorator) => conflict.names.includes(decorator.getName()));
    return hit === undefined ? undefined : `@${hit.getName()}`;
  }

  for (const decorator of decorators) {
    const documented = statusesDocumentedBy(decorator);
    if (documented === 'unreadable') {
      return `@${decorator.getName()}, whose status this tool cannot read`;
    }
    if (documented.includes(conflict.status)) return `@${decorator.getName()}`;
  }

  return undefined;
}

/**
 * Which statuses one decorator documents: a list, or the statement that it cannot be read.
 *
 * @param decorator - Any decorator on a class or a method
 * @returns The statuses, empty when the decorator documents none, or `unreadable`
 */
function statusesDocumentedBy(decorator: Decorator): readonly number[] | 'unreadable' {
  const name = decorator.getName();

  const shorthand = RESPONSE_SHORTHANDS[name];
  if (shorthand !== undefined) return [shorthand];

  if (name === 'ApiResponse') {
    const argument = decorator.getArguments()[0];
    if (argument === undefined || !Node.isObjectLiteralExpression(argument)) return 'unreadable';

    const property = argument.getProperty('status');
    if (property === undefined || !Node.isPropertyAssignment(property)) return 'unreadable';

    const initializer = property.getInitializer();
    if (initializer === undefined || !Node.isNumericLiteral(initializer)) return 'unreadable';

    return [initializer.getLiteralValue()];
  }

  // AN UNKNOWN `Api...Response` IS UNREADABLE RATHER THAN IRRELEVANT. `@nestjs/swagger` may gain a
  // shorthand this table does not have, and one naming the status about to be written would let a
  // second assertion in beside the first, which is the one thing this mode must never do.
  if (name.startsWith('Api') && name.endsWith('Response')) return 'unreadable';

  return [];
}

/** What extending the file's imports would take. */
type ImportPlan =
  | { readonly kind: 'ready'; readonly splice?: Splice }
  | { readonly kind: 'refused'; readonly reason: FixSkipReason; readonly detail: string };

/**
 * Works out how to get every needed name in scope from `@nestjs/swagger`.
 *
 * AN EXISTING IMPORT IS EXTENDED AND NEVER REPLACED, per SPEC 7.4: adding `@ApiResponse` means
 * putting one name into the statement that is already there, leaving the rest of it, its order,
 * its line breaks and its trailing comma exactly as somebody wrote them.
 *
 * @param source - The parsed file
 * @param needed - Names the applied edits require, with duplicates
 * @returns The splice that adds them, nothing when they are all in scope, or a refusal
 */
function planImport(source: SourceFile, needed: readonly string[]): ImportPlan {
  const wanted = [...new Set(needed)];
  if (wanted.length === 0) return { kind: 'ready' };

  const declarations = source.getImportDeclarations();
  const swagger = declarations.filter(
    (declaration) => declaration.getModuleSpecifierValue() === SWAGGER_MODULE,
  );

  for (const declaration of swagger) {
    if (declaration.getNamespaceImport() !== undefined) {
      return {
        kind: 'refused',
        reason: 'no-mechanical-edit',
        detail: `${SWAGGER_MODULE} arrives through a namespace import, so this tool cannot tell what a decorator would be called here`,
      };
    }
  }

  const alreadyImported = new Set(
    swagger.flatMap((declaration) =>
      declaration
        .getNamedImports()
        .map((named) => named.getAliasNode()?.getText() ?? named.getName()),
    ),
  );

  const missing = wanted.filter((name) => !alreadyImported.has(name));
  if (missing.length === 0) return { kind: 'ready' };

  const taken = missing.find((name) => bindsName(source, declarations, name));
  if (taken !== undefined) {
    return {
      kind: 'refused',
      reason: 'no-mechanical-edit',
      detail: `${taken} already means something else in this file, so importing it would rename what is there`,
    };
  }

  const host = swagger.find((declaration) => declaration.getNamedImports().length > 0);
  return host === undefined
    ? { kind: 'ready', splice: newImportSplice(source, missing) }
    : { kind: 'ready', splice: extendImportSplice(source, host, missing) };
}

/** Whether a name is already bound in a file by an import from elsewhere or by a declaration. */
function bindsName(
  source: SourceFile,
  declarations: readonly ReturnType<SourceFile['getImportDeclarations']>[number][],
  name: string,
): boolean {
  for (const declaration of declarations) {
    if (declaration.getModuleSpecifierValue() === SWAGGER_MODULE) continue;
    if (declaration.getDefaultImport()?.getText() === name) return true;
    if (declaration.getNamespaceImport()?.getText() === name) return true;
    if (
      declaration
        .getNamedImports()
        .some((named) => (named.getAliasNode()?.getText() ?? named.getName()) === name)
    )
      return true;
  }

  const declared = [
    ...source.getClasses(),
    ...source.getFunctions(),
    ...source.getInterfaces(),
    ...source.getTypeAliases(),
    ...source.getEnums(),
    ...source.getVariableDeclarations(),
  ];

  return declared.some((entry) => entry.getName() === name);
}

/** The splice that adds a whole new import statement, placed after the last one in the file. */
function newImportSplice(source: SourceFile, names: readonly string[]): Splice {
  const statement = `import { ${names.join(', ')} } from '${SWAGGER_MODULE}';`;
  const imports = source.getImportDeclarations();
  const last = imports[imports.length - 1];

  if (last !== undefined) return { pos: last.getEnd(), text: `\n${statement}`, order: -1 };

  // AFTER THE LEADING COMMENTS AND NOT AT BYTE ZERO. A file that starts with a licence header or
  // a module comment would otherwise get the import above it, which is a diff a reviewer reads as
  // the tool having moved their header.
  const first = source.getStatements()[0];
  return { pos: first?.getStart() ?? 0, text: `${statement}\n`, order: -1 };
}

/**
 * The splice that puts names into an import statement that already exists.
 *
 * THE SHAPE OF THE STATEMENT IS COPIED RATHER THAN CHOSEN. A single line import gains its names on
 * the same line; a multi line one gains a line per name at the indentation its last name sits at,
 * and a trailing comma is kept trailing. The point is not tidiness: it is that the diff shows one
 * added name, not a reformatted import.
 */
function extendImportSplice(
  source: SourceFile,
  host: ReturnType<SourceFile['getImportDeclarations']>[number],
  names: readonly string[],
): Splice {
  const text = source.getFullText();
  const named = host.getNamedImports();
  const last = named[named.length - 1];
  const end = last === undefined ? host.getEnd() : last.getEnd();

  const closing = host.getFirstDescendantByKind(SyntaxKind.CloseBraceToken);
  const tail = text.slice(end, closing?.getStart() ?? end);
  const multiline = host.getText().includes('\n');

  if (!multiline) return { pos: end, text: `, ${names.join(', ')}`, order: -1 };

  const lineStart = text.lastIndexOf('\n', (last?.getStart() ?? end) - 1) + 1;
  const indent = /^[ \t]*/.exec(text.slice(lineStart))?.[0] ?? '  ';

  const comma = tail.indexOf(',');
  if (comma === -1) {
    const added = names.map((name) => `,\n${indent}${name}`).join('');
    return { pos: end, text: added, order: -1 };
  }

  const added = names.map((name) => `\n${indent}${name},`).join('');
  return { pos: end + comma + 1, text: added, order: -1 };
}

/**
 * Applies every insertion to the original text.
 *
 * DESCENDING BY OFFSET SO NO EARLIER INSERTION MOVES A LATER ONE, and, where two insertions share
 * an offset, the later one goes in first so that the two end up in the report's order. Nothing is
 * ever deleted, so every byte of the input survives, in order, in the output.
 *
 * @param text - The original file
 * @param splices - Every insertion, in any order
 * @returns The new text
 */
function applySplices(text: string, splices: readonly Splice[]): string {
  const ordered = [...splices].sort((left, right) =>
    left.pos === right.pos ? right.order - left.order : right.pos - left.pos,
  );

  let result = text;
  for (const splice of ordered) {
    result = `${result.slice(0, splice.pos)}${splice.text}${result.slice(splice.pos)}`;
  }

  return result;
}
