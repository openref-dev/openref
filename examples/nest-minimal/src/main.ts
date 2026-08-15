import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { OpenRefModule } from '@openref/nest';
import type { INestApplication } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { registerPaymentInstructionSchemas } from './orders.payment.js';
import { registerPortal } from './portal.js';

/** Which platform adapter to boot on. */
export type Platform = 'express' | 'fastify';

/**
 * The whole of SPEC 2's first minute.
 *
 * Build the OpenAPI document the way any NestJS application already does, then one line. The
 * reference is served at `/docs`, with search, schemas and a try-it console that sends to this
 * same application.
 *
 * @param platform - Adapter to boot on, since OPENREF supports both
 * @returns The application, not yet listening
 */
export async function createApp(platform: Platform = 'express'): Promise<INestApplication> {
  const app =
    platform === 'fastify'
      ? await createFastifyApp()
      : await NestFactory.create(AppModule, { logger: false });

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Orders')
      .setDescription('A very small API, so the reference has something to describe.')
      .setVersion('1.0.0')
      // 3.1 rather than the 3.0 the builder defaults to. Both normalize to one IR, which is
      // half the point of the compatibility matrix: the NestJS 10 fixture leaves the default
      // in place, so the two arms cover both OpenAPI versions.
      .setOpenAPIVersion('3.1.0')
      // Where this API answers. `/` means "wherever this document is served from", which is
      // the honest answer for an API that ships its own reference, and it is what the try-it
      // console sends to. A deployment behind a gateway sets `PUBLIC_URL` to its real origin.
      .addServer(process.env.PUBLIC_URL ?? '/')
      .addTag('orders')
      .build(),
  );

  // The value dependent shapes of SPEC 11, registered raw on the document the application
  // owns, because the decorator DSL has no conditional vocabulary: see orders.payment.ts.
  registerPaymentInstructionSchemas(document);

  OpenRefModule.setup('/docs', app, {
    document,
    // The same origin proxy of SPEC 14.5, off by default the way it is for every host. The
    // browser suite sets the variable to prove the shipped page selects the proxy transport
    // when a host turns the proxy on; the fail closed policy behind the route is unchanged.
    ...(process.env.OPENREF_PROXY === '1' ? { proxy: { enabled: true } } : {}),
    // The theme pair of T033, selected the way a host would select it: the definition for the
    // server render and the entry built with it for the browser. The browser suite sets the
    // variable to prove the same theme reaches both halves of one page.
    ...(process.env.OPENREF_THEME === 'telltale'
      ? {
          theme: {
            definition: (await import('@openref/theme-telltale')).telltale,
            bundle: '@openref/theme-telltale/entry',
          },
        }
      : {}),
  });

  // The embed demo of SPEC 10.3, host infrastructure rather than API surface: see portal.ts
  // for why it is raw routes and Express only.
  registerPortal(app);

  return app;
}

/**
 * The same application on Fastify.
 *
 * Kept apart so the Express path never imports the Fastify platform package, which is what a
 * real application would look like.
 *
 * @returns The application, not yet listening
 */
async function createFastifyApp(): Promise<INestApplication> {
  const { FastifyAdapter } = await import('@nestjs/platform-fastify');

  return NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: false,
  });
}
