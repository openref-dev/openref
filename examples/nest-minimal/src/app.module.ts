import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller.js';

/**
 * The whole application: one controller.
 *
 * An empty class is how NestJS declares a module. There is no other spelling.
 */
@Module({ controllers: [OrdersController] })
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AppModule {}
