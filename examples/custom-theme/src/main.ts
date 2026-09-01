import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ApiOkResponse, ApiTags, DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { OpenRefModule } from '@openref/nest';
import type { INestApplication } from '@nestjs/common';
import { acmeTheme } from './acme.theme.js';

/** One field, because this example is about the theme rather than about the schema. */
export class NoteDto {
  id!: string;
  body!: string;
}

/** Two routes, so there is a list and a detail page to look at. */
@ApiTags('notes')
@Controller('notes')
export class NotesController {
  @Get()
  @ApiOkResponse({ type: NoteDto, isArray: true })
  list(): NoteDto[] {
    return [{ id: 'n_1', body: 'The accent colour on this page came from six token values.' }];
  }

  @Get('latest')
  @ApiOkResponse({ type: NoteDto })
  latest(): NoteDto {
    return { id: 'n_1', body: 'No bundle was built to make that happen.' };
  }
}

/**
 * The module, with nothing in it but the controller.
 *
 * NO `forRoot` ANYWHERE, AND THAT IS DELIBERATE. This example is SPEC 13.1's minimal form plus a
 * theme, so it is also the smallest application in this repository that mounts a reference
 * without the runtime pass. Between 2026-08-31 and 2026-09-01 it carried
 * `OpenRefModule.forRoot({})` as a workaround, because `setup` on a default boot ended the
 * process with exit code 1; that is fixed in `referencesIn` and proved by
 * `packages/nest/test/integration/first-minute.spec.ts`, so the workaround is gone.
 */
@Module({ controllers: [NotesController] })
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AppModule {}

/**
 * The application, with the theme selected the way a host selects one.
 *
 * @returns The application, not yet listening
 */
export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: false });

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Notes')
      .setDescription('A very small API, wearing a theme that is six token values long.')
      .setVersion('1.0.0')
      .setOpenAPIVersion('3.1.0')
      .addServer(process.env.PUBLIC_URL ?? '/')
      .addTag('notes')
      .build(),
  );

  OpenRefModule.setup('/docs', app, { document, theme: { definition: acmeTheme } });

  return app;
}
