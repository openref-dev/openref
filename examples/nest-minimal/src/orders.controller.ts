import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';

/** One order, as the API returns it. */
export class OrderDto {
  @ApiProperty({ description: 'Identifier of the order.', example: 'ord_1024' })
  id!: string;

  @ApiProperty({ description: 'Total in minor units.', example: 4500 })
  amount!: number;

  @ApiProperty({ description: 'ISO 4217 currency code.', example: 'EUR' })
  currency!: string;
}

/** What creating an order needs. */
export class CreateOrderDto {
  @ApiProperty({ description: 'Total in minor units.', example: 4500 })
  amount!: number;

  @ApiProperty({ description: 'ISO 4217 currency code.', example: 'EUR' })
  currency!: string;
}

const ORDERS: OrderDto[] = [
  { id: 'ord_1024', amount: 4500, currency: 'EUR' },
  { id: 'ord_1025', amount: 1200, currency: 'USD' },
];

/**
 * A small, real controller.
 *
 * It exists so the reference has something to describe and the try-it console has somewhere
 * to send a request, which is the whole of SPEC 2's first minute.
 */
@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  /**
   * Lists orders.
   *
   * @param currency - Optional currency filter
   * @returns The orders
   */
  @Get()
  @ApiOperation({ summary: 'List orders', description: 'Every order, newest first.' })
  @ApiOkResponse({ type: OrderDto, isArray: true })
  list(@Query('currency') currency?: string): OrderDto[] {
    if (currency === undefined || currency === '') return ORDERS;

    return ORDERS.filter((order) => order.currency === currency);
  }

  /**
   * Reads one order.
   *
   * @param id - Identifier of the order
   * @returns The order, or a made up one when the id is unknown, since this is an example
   */
  @Get(':id')
  @ApiOperation({ summary: 'Read one order' })
  @ApiOkResponse({ type: OrderDto })
  read(@Param('id') id: string): OrderDto {
    return ORDERS.find((order) => order.id === id) ?? { id, amount: 0, currency: 'EUR' };
  }

  /**
   * Creates an order.
   *
   * @param body - Amount and currency
   * @returns The created order
   */
  @Post()
  @ApiOperation({ summary: 'Create an order' })
  @ApiOkResponse({ type: OrderDto })
  create(@Body() body: CreateOrderDto): OrderDto {
    return {
      id: `ord_${String(ORDERS.length + 1024)}`,
      amount: body.amount,
      currency: body.currency,
    };
  }
}
