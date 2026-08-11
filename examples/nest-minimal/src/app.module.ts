import { Module } from '@nestjs/common';
import { OpenRefModule } from '@openref/nest';
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
 * An empty class is how NestJS declares a module. There is no other spelling.
 */
@Module({ controllers: [OrdersController], imports: [OpenRefModule.forRoot({})] })
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AppModule {}
