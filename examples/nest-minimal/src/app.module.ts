import { Module } from '@nestjs/common';
import { OpenRefModule, sourceCollector } from '@openref/nest';
import { OrdersController } from './orders.controller.js';

/**
 * The whole application: one controller, and the runtime intelligence of SPEC 6.
 *
 * `forRoot` MOUNTS NOTHING HERE, AND THAT IS THE ORDINARY SHAPE RATHER THAN A CURIOSITY. The
 * document comes from `SwaggerModule.createDocument(app, ...)`, which needs the application, so
 * it does not exist until after `NestFactory.create` has returned, which is after this array is
 * read. What `forRoot` contributes is the container: it is the only place `DiscoveryService` can
 * be injected, and that is the only public route to the controller classes every runtime fact
 * hangs off. `main.ts` then calls `setup` with the document, and the pass is picked up from here.
 *
 * THE SOURCE LINK POINTS AT THIS REPOSITORY, which is what makes the demo demonstrate anything.
 * `sourceCollector` asks V8 where each handler is written and puts the file and the line in the
 * IR; the template turns them into a link. `tsconfig.json` sets `sourceMap: true` for the same
 * reason: without it the answer would be a line in `dist/`, and a link into a build directory is
 * the difference between the feature working and appearing to work.
 *
 * The revision is read from git. A build with no `.git` passes it instead, as
 * `sourceLink: { template, ref }`.
 *
 * An empty class is how NestJS declares a module. There is no other spelling.
 */
@Module({
  controllers: [OrdersController],
  imports: [
    OpenRefModule.forRoot({
      runtime: {
        collectors: [sourceCollector()],
        sourceLink: 'https://github.com/sur-ser/openref/blob/{ref}/{file}#L{line}',
      },
    }),
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AppModule {}
