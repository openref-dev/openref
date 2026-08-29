import { Controller, Get, Module, Param, UseGuards } from '@nestjs/common';
import { BasicGuard, BearerGuard } from './guards.js';

/**
 * The two remote services of the demo: real HTTP APIs in a second application, each serving
 * its own reference, which is where the gateway fetches their specifications from.
 *
 * THEY ARE REMOTES AND SO THEY HAVE NO RUNTIME FACTS ON THE FEDERATED PAGE, per SPEC 15.3: a
 * remote arrives as a specification, and the facts of SPEC 6 live in the process that runs the
 * controllers. Their own references, mounted in `main.ts`, are where their facts would be.
 */

@Controller('orders')
@UseGuards(BearerGuard)
export class OrdersController {
  @Get()
  list(): { orders: readonly { id: string; state: string }[] } {
    return { orders: [{ id: 'ord_1', state: 'open' }] };
  }

  @Get(':orderId')
  read(@Param('orderId') orderId: string): { id: string; state: string } {
    return { id: orderId, state: 'open' };
  }
}

@Controller('payments')
@UseGuards(BasicGuard)
export class PaymentsController {
  @Get()
  list(): { payments: readonly { id: string; settled: boolean }[] } {
    return { payments: [{ id: 'pay_1', settled: true }] };
  }
}

/** The services application: both controllers, no reference of its own until `main.ts` mounts two. */
@Module({ controllers: [OrdersController, PaymentsController] })
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class RemoteServicesModule {}

/** Orders' specification, served at its own reference and fetched by the gateway. */
export function ordersSpecification(origin: string): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Orders',
      version: '2.0.0',
      description: 'Order intake and state. A separate application the gateway polls.',
    },
    servers: [{ url: origin }],
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
    security: [{ bearer: [] }],
    paths: {
      '/orders': {
        get: {
          operationId: 'listOrders',
          summary: 'List orders',
          responses: { '200': { description: 'A page of orders' } },
        },
      },
      '/orders/{orderId}': {
        get: {
          operationId: 'readOrder',
          summary: 'Read one order',
          parameters: [{ name: 'orderId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'The order' } },
        },
      },
    },
  };
}

/** Payments' specification, the third service and the third auth scheme. */
export function paymentsSpecification(origin: string): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Payments',
      version: '0.9.0',
      description: 'Settlement. A separate application the gateway polls.',
    },
    servers: [{ url: origin }],
    components: { securitySchemes: { basic: { type: 'http', scheme: 'basic' } } },
    security: [{ basic: [] }],
    paths: {
      '/payments': {
        get: {
          operationId: 'listPayments',
          summary: 'List payments',
          responses: { '200': { description: 'A page of payments' } },
        },
      },
    },
  };
}
