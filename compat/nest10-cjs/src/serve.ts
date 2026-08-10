/**
 * The other arm of the SPEC 23 compatibility matrix.
 *
 * NestJS 10, `@nestjs/swagger` 8, and CommonJS. Three things are being checked at once and
 * each one is a real failure mode:
 *
 * - NESTJS 10 rather than 11. The two differ in the Express major underneath, and Express 4
 *   and 5 disagree about route patterns. `reference/domain/routes.ts` avoids wildcards for
 *   exactly this reason, and this is what proves it worked.
 * - `@nestjs/swagger` 8 rather than 11. It emits OpenAPI 3.0 where 11 emits 3.1, and the
 *   normalizer uplifts both to one IR. There is no swagger 9 or 10 to test: the package went
 *   from 8 to 11 to line its major up with NestJS, which is a defect in SPEC 23's version
 *   list, recorded in `ai-docs/PROJECT_STATE.md`.
 * - COMMONJS. `require('@openref/nest')` must not raise `ERR_REQUIRE_ESM`, which SPEC 23 names
 *   as inadmissible. Two of this package's dependencies publish ESM only, so the CJS build
 *   reaches them through dynamic import; this is the consumer that proves it.
 *
 * It is a workspace package of its own so that it carries its own NestJS 10 tree beside the
 * repository's 11 one. Aliasing the versions into a single tree would not work: the framework
 * packages resolve each other by real name, so an aliased core would load the other common.
 */

import 'reflect-metadata';
import { Controller, Get, Module, Param } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ApiOkResponse, ApiProperty, DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { OpenRefModule } from '@openref/nest';
import type { INestApplication } from '@nestjs/common';

/** One order. */
class OrderDto {
  @ApiProperty({ description: 'Identifier of the order.' })
  id!: string;

  @ApiProperty({ description: 'Total in minor units.' })
  amount!: number;
}

@Controller('orders')
class OrdersController {
  /**
   * Reads one order.
   *
   * @param id - Identifier of the order
   * @returns The order
   */
  @Get(':id')
  @ApiOkResponse({ type: OrderDto })
  read(@Param('id') id: string): OrderDto {
    return { id, amount: 4500 };
  }
}

// An empty class is how NestJS declares a module. There is no other spelling.
@Module({ controllers: [OrdersController] })
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class AppModule {}

/**
 * Boots the application and mounts the reference.
 *
 * @param platform - Adapter to boot on
 * @returns The application, not yet listening
 */
async function createApp(platform: string): Promise<INestApplication> {
  let app: INestApplication;

  if (platform === 'fastify') {
    const { FastifyAdapter } = await import('@nestjs/platform-fastify');
    app = await NestFactory.create(AppModule, new FastifyAdapter(), { logger: false });
  } else {
    app = await NestFactory.create(AppModule, { logger: false });
  }

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('Orders').setVersion('1.0.0').build(),
  );

  OpenRefModule.setup('/docs', app, { document });

  return app;
}

/** Runs it, printing the url it listens on. */
async function serve(): Promise<void> {
  const args = process.argv.slice(2);
  const value = (name: string): string | undefined =>
    args.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1];

  const platform = value('adapter') === 'fastify' ? 'fastify' : 'express';
  const app = await createApp(platform);

  await app.listen(Number(value('port') ?? 0), '127.0.0.1');

  const url = await app.getUrl();
  process.stdout.write(`${JSON.stringify({ ready: true, platform, url })}\n`);
}

void serve();
