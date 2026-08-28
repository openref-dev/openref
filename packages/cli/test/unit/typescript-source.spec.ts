import { describe, expect, it } from 'vitest';
import { decoratorFor } from '../../src/cli/domain/fix-plan';
import { rewriteSource } from '../../src/cli/infrastructure/adapters/typescript-source.adapter';
import type { PlannedEdit } from '../../src/cli/domain/fix-plan';
import type { IRDriftAssertion } from '@openref/core';

/**
 * The rewriter, over strings, which is the only shape it ever sees.
 *
 * FORMAT PRESERVATION IS ASSERTED AS BYTE IDENTITY AND NOT EYEBALLED. Every insertion is exactly
 * that, an insertion, so removing the inserted text from the result has to give the input back
 * character for character. That assertion cannot be satisfied by a printer that reflows or
 * requotes a statement, which is why the test is written that way rather than as a snapshot.
 */

const FILE = 'src/orders.controller.ts';

/** One planned edit for a decorator, built the same way the planner builds it. */
function edit(assertion: IRDriftAssertion, overrides: Partial<PlannedEdit> = {}): PlannedEdit {
  const decorator = decoratorFor(assertion);
  if (decorator === undefined) throw new Error('the fixture asked for an unwritable assertion');

  return {
    rule: 'missing-operation-id',
    code: 'DX030',
    confidence: 'declared',
    subject: 'GET /orders',
    file: FILE,
    controller: 'OrdersController',
    handler: 'list',
    decorator,
    ...overrides,
  };
}

const OPERATION_ID: IRDriftAssertion = { kind: 'operation-id', operationId: 'list' };
const RATE_LIMIT: IRDriftAssertion = {
  kind: 'response-status',
  status: 429,
  description: 'Too Many Requests',
};

/** A controller with the import line the fixture needs and one handler. */
function controller(options: {
  readonly imports?: string;
  readonly decorators?: string;
  readonly classDecorators?: string;
}): string {
  return [
    "import { Controller, Get } from '@nestjs/common';",
    options.imports ?? "import { ApiTags } from '@nestjs/swagger';",
    '',
    options.classDecorators ?? "@Controller('orders')",
    'export class OrdersController {',
    ...(options.decorators === undefined ? [] : [options.decorators]),
    '  @Get()',
    '  list(): string[] {',
    "    return ['ord_1'];",
    '  }',
    '}',
    '',
  ].join('\n');
}

describe('rewriteSource', () => {
  it('should insert the decorator above the handler at the handler own indentation', () => {
    // Given
    const text = controller({
      imports: "import { ApiOperation, ApiTags } from '@nestjs/swagger';",
    });

    // When
    const result = rewriteSource(FILE, text, [edit(OPERATION_ID)]);

    // Then
    expect(result.applied).toHaveLength(1);
    expect(result.text).toContain("  @ApiOperation({ operationId: 'list' })\n  @Get()");
  });

  it('should leave every byte outside the insertion identical, which is what a reviewable diff is', () => {
    // Given
    const text = controller({
      imports: "import { ApiOperation, ApiTags } from '@nestjs/swagger';",
    });
    const inserted = "@ApiOperation({ operationId: 'list' })\n  ";

    // When
    const result = rewriteSource(FILE, text, [edit(OPERATION_ID)]);

    // Then
    expect(result.text).not.toBe(text);
    expect(result.text.split(inserted).join('')).toBe(text);
  });

  it('should add one name to a single line import and change nothing else about the statement', () => {
    // Given
    const text = controller({ imports: "import { ApiTags } from '@nestjs/swagger';" });

    // When
    const result = rewriteSource(FILE, text, [edit(OPERATION_ID)]);

    // Then
    expect(result.text).toContain("import { ApiTags, ApiOperation } from '@nestjs/swagger';");
    expect(result.applied).toHaveLength(1);
  });

  it('should add a line to a multi line import and keep its trailing comma trailing', () => {
    // Given
    const text = controller({
      imports: ['import {', '  ApiTags,', "} from '@nestjs/swagger';"].join('\n'),
    });

    // When
    const result = rewriteSource(FILE, text, [edit(OPERATION_ID)]);

    // Then
    expect(result.text).toContain(
      ['import {', '  ApiTags,', '  ApiOperation,', "} from '@nestjs/swagger';"].join('\n'),
    );
  });

  it('should add a whole import statement after the last one when the module is not imported at all', () => {
    // Given
    const text = controller({ imports: "import { Injectable } from '@nestjs/common';" });

    // When
    const result = rewriteSource(FILE, text, [edit(OPERATION_ID)]);

    // Then
    expect(result.text).toContain(
      [
        "import { Injectable } from '@nestjs/common';",
        "import { ApiOperation } from '@nestjs/swagger';",
      ].join('\n'),
    );
  });

  it('should refuse to reach inside an ApiOperation the handler already carries', () => {
    // Given
    const text = controller({
      imports: "import { ApiOperation, ApiTags } from '@nestjs/swagger';",
      decorators: "  @ApiOperation({ summary: 'List orders' })",
    });

    // When
    const result = rewriteSource(FILE, text, [edit(OPERATION_ID)]);

    // Then
    expect(result.text).toBe(text);
    expect(result.applied).toHaveLength(0);
    expect(result.refused[0]?.reason).toBe('existing-decorator');
    expect(result.refused[0]?.detail).toContain('@ApiOperation');
  });

  it('should add a response beside one documenting a different status, which alters nothing', () => {
    // Given
    const text = controller({
      imports: "import { ApiResponse, ApiTags } from '@nestjs/swagger';",
      decorators: '  @ApiResponse({ status: 200 })',
    });

    // When
    const result = rewriteSource(FILE, text, [edit(RATE_LIMIT)]);

    // Then
    expect(result.applied).toHaveLength(1);
    expect(result.text).toContain(
      "@ApiResponse({ status: 429, description: 'Too Many Requests' })",
    );
  });

  it('should refuse a response for a status an existing decorator already documents', () => {
    // Given
    const text = controller({
      imports: "import { ApiResponse, ApiTags } from '@nestjs/swagger';",
      decorators: '  @ApiResponse({ status: 429 })',
    });

    // When
    const result = rewriteSource(FILE, text, [edit(RATE_LIMIT)]);

    // Then
    expect(result.applied).toHaveLength(0);
    expect(result.refused[0]?.reason).toBe('existing-decorator');
  });

  it('should read a shorthand response decorator as the status it stands for', () => {
    // Given
    const text = controller({
      imports: "import { ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';",
      decorators: '  @ApiTooManyRequestsResponse()',
    });

    // When
    const result = rewriteSource(FILE, text, [edit(RATE_LIMIT)]);

    // Then
    expect(result.applied).toHaveLength(0);
    expect(result.refused[0]?.detail).toContain('@ApiTooManyRequestsResponse');
  });

  it('should refuse a response decorator whose status it cannot read, rather than assume it differs', () => {
    // Given
    const text = controller({
      imports: "import { ApiResponse, ApiTags } from '@nestjs/swagger';",
      decorators: '  @ApiResponse(SHARED_ERROR)',
    });

    // When
    const result = rewriteSource(FILE, text, [edit(RATE_LIMIT)]);

    // Then
    expect(result.applied).toHaveLength(0);
    expect(result.refused[0]?.detail).toContain('cannot read');
  });

  it('should treat a decorator on the controller as an existing assertion, since it applies to every route', () => {
    // Given
    const text = controller({
      imports: "import { ApiSecurity, ApiTags } from '@nestjs/swagger';",
      classDecorators: ["@Controller('orders')", "@ApiSecurity('bearer')"].join('\n'),
    });

    // When
    const result = rewriteSource(FILE, text, [edit({ kind: 'security-scheme', scheme: 'oauth2' })]);

    // Then
    expect(result.applied).toHaveLength(0);
    expect(result.refused[0]?.reason).toBe('existing-decorator');
  });

  it('should refuse every edit in a file whose swagger names arrive through a namespace import', () => {
    // Given
    const text = controller({ imports: "import * as swagger from '@nestjs/swagger';" });

    // When
    const result = rewriteSource(FILE, text, [edit(OPERATION_ID)]);

    // Then
    expect(result.text).toBe(text);
    expect(result.refused[0]?.detail).toContain('namespace import');
  });

  it('should refuse to import a name that already means something else in the file', () => {
    // Given
    const text = controller({
      imports: ["import { ApiTags } from '@nestjs/swagger';", 'const ApiOperation = 1;'].join('\n'),
    });

    // When
    const result = rewriteSource(FILE, text, [edit(OPERATION_ID)]);

    // Then
    expect(result.applied).toHaveLength(0);
    expect(result.refused[0]?.detail).toContain('already means something else');
  });

  it('should say the class is missing rather than write into whatever class is there', () => {
    // Given
    const text = controller({});

    // When
    const result = rewriteSource(FILE, text, [
      edit(OPERATION_ID, { controller: 'OtherController' }),
    ]);

    // Then
    expect(result.refused[0]?.reason).toBe('no-source-location');
    expect(result.refused[0]?.detail).toContain('OtherController');
  });

  it('should say the method is missing rather than pick a neighbouring one', () => {
    // Given
    const text = controller({});

    // When
    const result = rewriteSource(FILE, text, [edit(OPERATION_ID, { handler: 'read' })]);

    // Then
    expect(result.refused[0]?.reason).toBe('no-source-location');
    expect(result.refused[0]?.detail).toContain('read');
  });

  it('should keep two decorators on one handler in the report order they arrived in', () => {
    // Given
    const text = controller({
      imports: "import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';",
    });

    // When
    const result = rewriteSource(FILE, text, [edit(OPERATION_ID), edit(RATE_LIMIT)]);

    // Then
    expect(result.applied).toHaveLength(2);
    const operationAt = result.text.indexOf('@ApiOperation');
    const responseAt = result.text.indexOf('@ApiResponse');
    expect(operationAt).toBeGreaterThan(-1);
    expect(operationAt).toBeLessThan(responseAt);
  });

  it('should write nothing at all when there is nothing to write, leaving the text identical', () => {
    // Given
    const text = controller({});

    // When
    const result = rewriteSource(FILE, text, []);

    // Then
    expect(result.text).toBe(text);
    expect(result.applied).toHaveLength(0);
    expect(result.refused).toHaveLength(0);
  });
});
