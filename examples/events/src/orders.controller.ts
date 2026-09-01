import { Body, Controller, Injectable, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ApiChannel, ApiMessage, ApiPublishes } from '@openref/nest';

/** What a caller sends. */
export class CreateOrderDto {
  @ApiProperty()
  sku!: string;

  @ApiProperty()
  quantity!: number;
}

/** What the endpoint answers with, and what the event carries. */
export class OrderDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  sku!: string;

  @ApiProperty()
  quantity!: number;
}

/**
 * The HTTP half, and the one line that makes the two halves one graph.
 *
 * `@ApiPublishes` IS THE EDGE. Without it there are two documents beside each other: an API
 * that happens to have endpoints and a broker that happens to have channels. With it the
 * reference can say that this endpoint publishes this event and that these handlers receive it,
 * which is the thing neither document says on its own.
 */
@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  @Post()
  @ApiPublishes('orders.created')
  @ApiCreatedResponse({ type: OrderDto })
  create(@Body() body: CreateOrderDto): OrderDto {
    return { id: 'ord_1024', sku: body.sku, quantity: body.quantity };
  }
}

/**
 * The events half.
 *
 * BOTH CHANNELS ARE DECLARED RATHER THAN DISCOVERED, and that is this example's one deliberate
 * narrowing. A handler carrying `@MessagePattern('orders.created', Transport.KAFKA)` is
 * discovered from the framework's own metadata with no decorator of ours at all, which is the
 * ordinary case; it is left out here only so this example installs nothing beyond the packages
 * every other example installs. `packages/nest/test/integration/events.spec.ts` boots the
 * discovered form on both adapters.
 *
 * WHAT COULD NOT BE DISCOVERED EITHER WAY IS THE PAYLOAD. A class name does not survive
 * compilation inside a generic, so `@ApiMessage({ payload: OrderDto })` is how the message's
 * shape is stated, and the name is resolved against the schemas the mount is given.
 */
@Injectable()
export class OrdersProjector {
  @ApiChannel({
    address: 'orders.created',
    protocol: 'kafka',
    direction: 'receive',
    summary: 'An order was accepted',
  })
  @ApiMessage({ payload: OrderDto })
  onCreated(): void {
    // A projector would write to a read model here.
  }

  @ApiChannel({
    address: 'orders.shipped',
    protocol: 'amqp',
    direction: 'send',
    summary: 'An order left the warehouse',
  })
  @ApiMessage({ payload: OrderDto })
  onShipped(): void {
    // And publish here.
  }
}
