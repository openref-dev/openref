import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  declarationsCollector,
  guardsCollector,
  OpenRefModule,
  sourceCollector,
} from '@openref/nest';
import type { INestApplication, Type } from '@nestjs/common';
import { OrdersController, OrdersProjector } from './orders.controller.js';

/**
 * Two mounts from one application: the HTTP reference and the events reference.
 *
 * THE EVENTS ENTRY CARRIES NO `document`, AND THAT IS WHY IT LIVES HERE RATHER THAN IN `setup`.
 * There is nothing to hand it: an AsyncAPI document is synthesized from the channels discovered
 * on this application's own handlers, and discovery needs the container, which is what
 * `forRoot` provides.
 *
 * `schemas` IS THE OPENAPI DOCUMENT'S OWN COMPONENT MAP, passed in below after the document is
 * built, so a DTO is described once and both references point at the same schema. A payload
 * name nothing answers reaches `doctor` rather than being invented.
 */
function applicationModule(schemas: Readonly<Record<string, unknown>>): Type<unknown> {
  @Module({
    controllers: [OrdersController],
    providers: [OrdersProjector],
    imports: [
      OpenRefModule.forRoot({
        documents: [
          {
            id: 'events',
            route: '/docs/events',
            kind: 'events',
            title: 'Orders events',
            schemas,
            servers: [
              { protocol: 'kafka', host: 'kafka.example.com:9092' },
              { protocol: 'amqp', host: 'rabbit.example.com:5672' },
            ],
          },
        ],
        runtime: {
          collectors: [sourceCollector(), guardsCollector(), declarationsCollector()],
          sourceLink: 'https://github.com/sur-ser/openref/blob/{ref}/{file}#L{line}',
        },
      }),
    ],
  })
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  class AppModule {}

  return AppModule;
}

/**
 * The two schema descriptions the events mount resolves message payloads against.
 *
 * WRITTEN OUT RATHER THAN READ OFF A DOCUMENT THAT DOES NOT EXIST YET, which is the whole
 * awkwardness of this shape and the reason it is commented. `SwaggerModule.createDocument`
 * needs an application, the application needs this module, and this module needs the schemas,
 * so one of the three has to be broken. A real application with a build step reads its
 * `components.schemas` from the document it already generates.
 */
const MESSAGE_SCHEMAS: Readonly<Record<string, unknown>> = {
  OrderDto: {
    type: 'object',
    required: ['id', 'sku', 'quantity'],
    properties: {
      id: { type: 'string' },
      sku: { type: 'string' },
      quantity: { type: 'integer' },
    },
  },
};

/**
 * The application, both references mounted, not yet listening.
 *
 * @returns The application
 */
export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(applicationModule(MESSAGE_SCHEMAS), { logger: false });

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Orders')
      .setDescription('One endpoint, which publishes an event two handlers know about.')
      .setVersion('1.0.0')
      .setOpenAPIVersion('3.1.0')
      .addServer(process.env.PUBLIC_URL ?? '/')
      .addTag('orders')
      .build(),
  );

  OpenRefModule.setup('/docs', app, { document });

  return app;
}
