import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { OpenRefModule } from '../../dist/index.js';

/**
 * SPEC 2's first minute as its own process, which is the only arrangement that can see it fail.
 *
 * WHY A SEPARATE PROCESS. The failure this fixture exists for is `process.exit(1)`, called by
 * NestJS's own `ExceptionsZone` when `abortOnError` is at its default. Inside a vitest worker
 * that call does not end the run, so an in process case passes whether the defect is present or
 * not; the exit code is the observation, and only a child has one. Measured on 2026-09-01: with
 * the fix reverted this fixture exits 1 with no output at all, and with it in place it exits 0
 * after serving a page.
 *
 * WHY THE BUILT ARTEFACT. It imports `../../dist/index.js` rather than the sources, for the
 * reason `cli-binary.spec.ts` gives: what a reader runs is the built package, and a proof about
 * a reader's first minute has to be about the thing the reader gets.
 *
 * WHY THE DECORATORS ARE APPLIED BY HAND. A decorator is a function, and this file is plain
 * JavaScript so that no compiler or loader has to stand between the fixture and the defect. The
 * three calls below are exactly what `@Get()`, `@Controller('orders')` and `@Module({...})`
 * do; nothing here is a substitute for the framework's behaviour.
 *
 * WHY THE DOCUMENT IS WRITTEN OUT. `packages/nest` does not depend on `@nestjs/swagger` and must
 * not start to, per the convention `forroot.spec.ts` states. What the first minute turns on is
 * the one line and what it mounts.
 */

class OrdersController {
  list() {
    return [{ id: 'ord_1024' }];
  }
}

Get()(OrdersController.prototype, 'list', Object.getOwnPropertyDescriptor(OrdersController.prototype, 'list'));
Controller('orders')(OrdersController);

class AppModule {}

Module({ controllers: [OrdersController] })(AppModule);

/** The whole of the first minute: no options anywhere, and the one line. */
const app = await NestFactory.create(AppModule, { logger: false });

OpenRefModule.setup('/docs', app, {
  document: {
    openapi: '3.1.0',
    info: { title: 'Orders', version: '1.0.0' },
    servers: [{ url: '/' }],
    paths: {
      '/orders': {
        get: { operationId: 'listOrders', responses: { 200: { description: 'Orders' } } },
      },
    },
  },
});

await app.listen(0, '127.0.0.1');

// THE JSON LINE IS THE INTERFACE, first, so the harness reads an address rather than guessing.
process.stdout.write(`${JSON.stringify({ ready: true, url: await app.getUrl() })}\n`);
