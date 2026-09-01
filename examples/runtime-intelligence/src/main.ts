import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { OpenRefModule } from '@openref/nest';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module.js';

/**
 * The application, built and mounted but not yet listening.
 *
 * @returns The application
 */
export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: false });

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Inventory')
      .setDescription('Three routes, so the three states of a runtime fact are on one page.')
      .setVersion('1.0.0')
      .setOpenAPIVersion('3.1.0')
      .addServer(process.env.PUBLIC_URL ?? '/')
      .addTag('inventory')
      .build(),
  );

  OpenRefModule.setup('/docs', app, { document });

  return app;
}
