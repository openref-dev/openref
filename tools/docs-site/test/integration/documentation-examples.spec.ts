import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';
import { GUIDE_DIRECTORY, REPOSITORY_ROOT, typescriptExamplesIn } from '../../src/index.ts';

/**
 * Every TypeScript example in the documentation, compiled by the real compiler.
 *
 * THE TASK ASKS FOR THIS TO BE ENFORCED BY A TEST RATHER THAN BY REVIEW, and the difference is
 * that a reviewer reads an example for plausibility while a compiler reads it for the packages
 * it actually names. Every fence below is written into a file, put in one program with the
 * workspace's own type declarations, and type checked with `strict` on.
 *
 * THE PLACEHOLDERS ARE AMBIENT, NOT IMPORTED, and that is what makes a two line example
 * possible. `docs/guide/00-first-minute.md` opens with `OpenRefModule.setup('/docs', app, {
 * document })` and neither `app` nor `document` is declared there, because a reader is being
 * shown one line rather than a program. So the surrounding application is supplied here, in
 * `declare global`, with its real types: the example still has to name real members of real
 * types, and only the two identifiers that stand for the reader's own application are given.
 *
 * A GLOBAL RATHER THAN AN IMPORT ALSO SETTLES THE COLLISION. One example quotes the collector
 * contract by declaring `export interface IRuntimeCollector`, which would clash with an import
 * of the same name and does not clash with a global, because a module scope shadows one.
 *
 * ONE FENCE IS EXCLUDED AND IT IS EXCLUDED BY NAME. SPEC 2's controller block is a quotation
 * with an elision in it, `...` where the body would be, so it is not a program in any context.
 * It stays a `ts` fence in `README.md` because `readme-reproduction.spec.ts` finds it by that
 * language and holds it against the served page. The count of such fences is asserted exactly,
 * so the exclusion cannot grow quietly.
 */

/** How a fence says it is a quotation rather than a program. */
const ELISION = '...';

/** Files whose fences are compiled, guide first and the README last. */
function documentationFiles(): readonly string[] {
  const chapters = readdirSync(GUIDE_DIRECTORY)
    .filter((file) => file.endsWith('.md'))
    .sort()
    .map((file) => join(GUIDE_DIRECTORY, file));

  return [...chapters, join(REPOSITORY_ROOT, 'README.md')];
}

/** One fence, with where it came from, so a failure names a place in a document. */
interface Example {
  readonly origin: string;
  readonly source: string;
}

/** Every fence of every documentation file, in reading order. */
function everyExample(): readonly Example[] {
  return documentationFiles().flatMap((file) =>
    typescriptExamplesIn(readFileSync(file, 'utf8')).map((source, index) => ({
      origin: `${file.slice(REPOSITORY_ROOT.length + 1)}#${String(index)}`,
      source,
    })),
  );
}

/** Whether a fence carries the elision marker on a line of its own. */
function isQuotation(example: Example): boolean {
  return example.source.split('\n').some((line) => line.trim() === ELISION);
}

/**
 * The surrounding application, as ambient declarations.
 *
 * EVERY TYPE HERE IS THE REAL ONE, imported from the workspace package that owns it. The only
 * invention is the set of identifiers, which is the reader's own application: their `app`, their
 * `document`, their DTOs and their module.
 */
const AMBIENT = `
type Nest = typeof import('@nestjs/common');
type NestCore = typeof import('@nestjs/core');
type Swagger = typeof import('@nestjs/swagger');
type OpenRef = typeof import('@openref/nest');
type Throttler = typeof import('@openref/collector-throttler');

declare const Module: Nest['Module'];
declare const Controller: Nest['Controller'];
declare const Injectable: Nest['Injectable'];
declare const Get: Nest['Get'];
declare const Post: Nest['Post'];
declare const Body: Nest['Body'];
declare const Param: Nest['Param'];
declare const Sse: Nest['Sse'];
declare const SetMetadata: Nest['SetMetadata'];
declare const UseGuards: Nest['UseGuards'];
declare const NestFactory: NestCore['NestFactory'];
declare const SwaggerModule: Swagger['SwaggerModule'];
declare const DocumentBuilder: Swagger['DocumentBuilder'];
declare const ApiOkResponse: Swagger['ApiOkResponse'];
declare const ApiTags: Swagger['ApiTags'];

declare const OpenRefModule: OpenRef['OpenRefModule'];
declare const ApiScopes: OpenRef['ApiScopes'];
declare const ApiErrors: OpenRef['ApiErrors'];
declare const ApiStream: OpenRef['ApiStream'];
declare const ApiChannel: OpenRef['ApiChannel'];
declare const ApiMessage: OpenRef['ApiMessage'];
declare const ApiPublishes: OpenRef['ApiPublishes'];
declare const paginated: OpenRef['paginated'];
declare const envelope: OpenRef['envelope'];
declare const sourceCollector: OpenRef['sourceCollector'];
declare const guardsCollector: OpenRef['guardsCollector'];
declare const declarationsCollector: OpenRef['declarationsCollector'];
declare const streamCollector: OpenRef['streamCollector'];
declare const scopesCollector: OpenRef['scopesCollector'];
declare const errorsCollector: OpenRef['errorsCollector'];
declare const pipesCollector: OpenRef['pipesCollector'];
declare const timeoutCollector: OpenRef['timeoutCollector'];
declare const headersCollector: OpenRef['headersCollector'];
declare const handlerScanCollector: OpenRef['handlerScanCollector'];
declare const httpCodeCollector: OpenRef['httpCodeCollector'];
declare const throttlerCollector: Throttler['throttlerCollector'];

type CollectorContext = import('@openref/nest').CollectorContext;
type IRuntimeCollector = import('@openref/nest').IRuntimeCollector;
// DERIVED FROM THE CONTRACT RATHER THAN IMPORTED, because \`IRNodeRuntime\` lives in
// \`@openref/core\` and an application that installs only \`@openref/nest\` cannot name it. That is
// itself one of the guide's points, so deriving it here is the same statement in type form.
type IRNodeRuntime = ReturnType<IRuntimeCollector['collect']>;
type Observable<T> = import('rxjs').Observable<T>;
type ThemeDefinition = import('@openref/nest').OpenRefThemeOptions['definition'];

// THE MESSAGE EVENT IS DECLARED HERE AND NOT IMPORTED, and the reason is the point SPEC 13.6
// makes. The DOM library is deliberately not loaded, since it would bring a global \`document\`
// of its own; and the generic parameter below is the one that does not survive compilation,
// which is exactly why \`@ApiStream({ itemType })\` has to exist at all.
interface MessageEvent<T = unknown> {
  readonly data: T;
}

// The reader's own application: the identifiers a short example stands on rather than declares.
declare const app: import('@nestjs/common').INestApplication;
declare const document: import('@nestjs/swagger').OpenAPIObject;
declare const config: ReturnType<InstanceType<Swagger['DocumentBuilder']>['build']>;
declare const AppModule: import('@nestjs/common').Type<unknown>;
declare const AdminDocsGuard: new (...args: never[]) => import('@nestjs/common').CanActivate;
declare const definition: ThemeDefinition;
declare const bundle: string;
declare const acme: ThemeDefinition;
declare const StateNotice: unknown;
declare const openApiSchemas: Readonly<Record<string, unknown>>;
declare const orderEvents: Observable<MessageEvent<OrderEventDto>>;
declare const SCOPES_KEY: string;
declare const TIMEOUT_KEY: string;
declare const REQUIRED_HEADERS_KEY: string;
declare const ORDER_ERRORS: Parameters<OpenRef['errorsCollector']>[0] extends
  { catalogs?: readonly (infer C)[] }
  ? C
  : never;

declare class OrderEventDto {}
declare class OrderDto {}
declare class CatDto {}
declare class RefundDto {}
declare class CreateOrderDto {}
declare class OrderNotFoundError extends Error {}

declare const orders: {
  byId(id: string): OrderDto;
  latest(): OrderDto;
  create(body: CreateOrderDto): OrderDto;
  refresh(): void;
};
declare const cats: { page(): unknown };
declare const refunds: { refresh(): void };

declare const MessagePattern: (address: string, transport?: unknown) => MethodDecorator;
declare const EventPattern: (address: string, transport?: unknown) => MethodDecorator;
declare const Transport: Readonly<Record<string, number>>;

declare function defineTheme<T>(theme: T): T;
`;

/**
 * Where the program is assembled, and why it is there rather than in the system temp directory.
 *
 * NODE RESOLUTION IS WHY. The ambient file names six real packages, and a program compiled in
 * `/tmp` resolves none of them: with `skipLibCheck` on, an unresolved module inside a
 * declaration file is not reported, every declared name silently becomes `any`, and the whole
 * suite passes on examples that name members no type has. That was the first version of this
 * file, and it was caught by planting `OpenRefModule.setup(1, 2, 3)` and watching it compile.
 *
 * So the program is assembled inside the node_modules of the example that already installs all
 * six, which is where node resolution finds them. `node_modules` also keeps the directory out
 * of git, out of eslint and out of the format allowlist.
 */
const RESOLUTION_ANCHOR = join(
  REPOSITORY_ROOT,
  'examples',
  'nest-minimal',
  'node_modules',
  '.openref-docs-examples',
);

/** The packages the ambient file names, each of which has to resolve. */
const AMBIENT_PACKAGES: readonly string[] = [
  '@nestjs/common',
  '@nestjs/core',
  '@nestjs/swagger',
  '@openref/nest',
  '@openref/collector-throttler',
  'rxjs',
];

/** The compiler options every program here is built with. */
const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  lib: ['lib.es2023.d.ts'],
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  esModuleInterop: true,
  experimentalDecorators: true,
  emitDecoratorMetadata: true,
};

/** Where the program is assembled. */
let workspace = '';

/**
 * Writes the ambient file and the given examples into a fresh program directory.
 *
 * @param sources - Example bodies, in order
 * @returns The directory, the example files, and the diagnostics the compiler reported
 */
function compile(sources: readonly string[]): {
  readonly files: readonly string[];
  readonly diagnostics: readonly ts.Diagnostic[];
} {
  mkdirSync(RESOLUTION_ANCHOR, { recursive: true });
  const directory = mkdtempSync(join(RESOLUTION_ANCHOR, 'program-'));
  if (workspace === '') workspace = RESOLUTION_ANCHOR;

  // EVERY FILE IS ESM, WHICH ONE EXAMPLE NEEDS. A file with no import and no export would be
  // read as CommonJS under NodeNext resolution, and the migration example opens with a top
  // level `await NestFactory.create`, which CommonJS refuses.
  writeFileSync(join(directory, 'package.json'), '{ "type": "module" }\n');

  const ambientFile = join(directory, 'ambient.d.ts');
  writeFileSync(ambientFile, AMBIENT);

  const files = sources.map((source, index) => {
    const file = join(directory, `example-${String(index)}.ts`);
    writeFileSync(file, source);
    return file;
  });

  const program = ts.createProgram([ambientFile, ...files], OPTIONS);
  return { files, diagnostics: ts.getPreEmitDiagnostics(program) };
}

afterAll(() => {
  if (workspace !== '') rmSync(workspace, { recursive: true, force: true });
});

describe('every TypeScript example in the documentation', () => {
  it('should be found before anything is proved about it', () => {
    // Given
    const examples = everyExample();

    // Then, so that a green compile below cannot mean an empty list
    expect(examples.length).toBeGreaterThan(25);
    expect(documentationFiles().length).toBeGreaterThan(8);
  });

  it('should quote SPEC 2 in exactly one fence, and compile every other one', () => {
    // Given
    const examples = everyExample();
    const quotations = examples.filter(isQuotation);

    // Then the exclusion is one fence, named, and it is the one the README suite pins
    expect(quotations.map((example) => example.origin)).toEqual(['README.md#1']);
    expect(quotations[0]?.source).toContain('@Controller');
  });

  it('should be checked by a compiler that resolved every package the ambient file names', () => {
    // Given: the anchor the program is assembled under
    mkdirSync(RESOLUTION_ANCHOR, { recursive: true });
    workspace = RESOLUTION_ANCHOR;
    const from = join(RESOLUTION_ANCHOR, 'probe', 'ambient.d.ts');

    // When
    const unresolved = AMBIENT_PACKAGES.filter(
      (specifier) =>
        ts.resolveModuleName(specifier, from, OPTIONS, ts.sys).resolvedModule === undefined,
    );

    // Then: a name that does not resolve is `any` under skipLibCheck, and every case below
    // would pass while checking nothing
    expect(unresolved).toEqual([]);
  });

  it('should be checked by a compiler that reports a planted error', () => {
    // Given a call no overload of the real signature accepts
    const planted = 'OpenRefModule.setup(1, 2, 3);\nexport {};\n';

    // When
    const { diagnostics } = compile([planted]);

    // Then
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(2345);
  }, 120_000);

  it('should compile, with strict type checking, against the real packages', () => {
    // Given
    const examples = everyExample().filter((example) => !isQuotation(example));

    // When
    const { files, diagnostics } = compile(examples.map((example) => example.source));

    // Then
    expect(
      diagnostics.map((diagnostic) => {
        const origin =
          examples[files.indexOf(diagnostic.file?.fileName ?? '')]?.origin ??
          diagnostic.file?.fileName ??
          'the ambient file';
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
        return `${origin}: TS${String(diagnostic.code)} ${message}`;
      }),
    ).toEqual([]);
  }, 120_000);
});

describe('the examples the documentation quotes from real files', () => {
  it('should quote the collector example from the application that runs it', () => {
    // Given
    const guide = readFileSync(join(GUIDE_DIRECTORY, '04-collectors.md'), 'utf8');
    const real = readFileSync(
      join(REPOSITORY_ROOT, 'examples', 'runtime-intelligence', 'src', 'ability.collector.ts'),
      'utf8',
    );

    // When: the guide's collector fence, and the same statements in the compiled application
    const quoted = typescriptExamplesIn(guide).find((example) =>
      example.includes('ABILITY_COLLECTOR_NAME'),
    );

    // Then, presence first
    expect(quoted).toBeDefined();
    for (const statement of (quoted ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('//'))) {
      expect(real).toContain(statement);
    }
  });

  it('should quote the first minute from the line the demo really calls', () => {
    // Given
    const guide = readFileSync(join(GUIDE_DIRECTORY, '00-first-minute.md'), 'utf8');
    const demo = readFileSync(
      join(REPOSITORY_ROOT, 'examples', 'nest-minimal', 'src', 'main.ts'),
      'utf8',
    );

    // Then
    expect(guide).toContain("OpenRefModule.setup('/docs', app, { document });");
    expect(demo).toContain("OpenRefModule.setup('/docs', app, {");
  });
});
