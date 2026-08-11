import { Body, Controller, Get, Header, Param, Post, Query } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  BankTransferDto,
  CardPaymentDto,
  CategoryDto,
  CreateOrderDto,
  OrderDto,
  ProblemDto,
  WalletPaymentDto,
} from './orders.dto.js';

const CATEGORIES: CategoryDto[] = [
  {
    slug: 'instruments',
    title: 'Instruments',
    children: [
      {
        slug: 'woodwind',
        title: 'Woodwind',
        children: [{ slug: 'flutes', title: 'Flutes' }],
      },
      { slug: 'strings', title: 'Strings' },
    ],
  },
  { slug: 'sheet-music', title: 'Sheet music' },
];

const FLUTES: CategoryDto = { slug: 'flutes', title: 'Flutes' };

const ORDERS: OrderDto[] = [
  {
    id: 'ord_1024',
    amount: 4500,
    currency: 'EUR',
    status: 'placed',
    customer: {
      id: 'cus_88',
      email: 'ada@example.com',
      billingAddress: {
        line1: 'Prinsengracht 263',
        city: 'Amsterdam',
        postalCode: '1016 GV',
        country: 'NL',
        geo: { latitude: 52.370216, longitude: 4.895168 },
      },
    },
    lines: [{ sku: 'sku_flute_c', quantity: 2, unitAmount: 2250, category: FLUTES }],
    payment: { kind: 'card', last4: '4242', network: 'visa' },
  },
  {
    id: 'ord_1025',
    amount: 1200,
    currency: 'USD',
    status: 'shipped',
    customer: {
      id: 'cus_91',
      email: 'grace@example.com',
      billingAddress: {
        line1: '1 Navy Yard',
        city: 'Washington',
        postalCode: '20003',
        country: 'US',
      },
    },
    lines: [{ sku: 'sku_score_bwv1013', quantity: 1, unitAmount: 1200, category: FLUTES }],
    payment: { kind: 'bank_transfer', iban: 'NL91ABNA0417164300', reference: 'ord_1025' },
  },
];

/**
 * A small, real controller.
 *
 * It exists so the reference has something to describe and the try-it console has somewhere to
 * send a request, which is the whole of SPEC 2's first minute. Every operation answers for real,
 * because a demo whose Send button fails is worse than no demo at all.
 *
 * THE ROUTE ORDER IS LOAD BEARING. `/orders/categories` is declared before `/orders/:id`,
 * because NestJS matches in declaration order and `:id` would otherwise swallow it.
 */
@ApiTags('orders')
@ApiExtraModels(CardPaymentDto, BankTransferDto, WalletPaymentDto)
@Controller('orders')
export class OrdersController {
  /**
   * Lists orders.
   *
   * NINE PARAMETERS AND A HEADER, ON PURPOSE. An operation with two parameters says nothing
   * about how a reference behaves when the parameter table is the largest thing on the page,
   * and nothing about the serialization rules a try-it console has to get right.
   *
   * @param currency - Optional currency filter
   * @param status - Optional status filter, repeatable
   * @param minAmount - Smallest total to return, in minor units
   * @param maxAmount - Largest total to return, in minor units
   * @returns The orders that matched
   */
  @Get()
  @ApiOperation({ summary: 'List orders', description: 'Every order, newest first.' })
  @ApiQuery({ name: 'currency', required: false, description: 'ISO 4217 code, such as EUR.' })
  @ApiQuery({
    name: 'status',
    required: false,
    isArray: true,
    enum: ['draft', 'placed', 'shipped', 'refunded'],
    style: 'form',
    explode: false,
    description: 'Repeatable. Comma separated, since `explode` is false.',
  })
  @ApiQuery({ name: 'minAmount', required: false, type: Number, description: 'Minor units.' })
  @ApiQuery({ name: 'maxAmount', required: false, type: Number, description: 'Minor units.' })
  @ApiQuery({ name: 'createdAfter', required: false, description: 'RFC 3339 timestamp.' })
  @ApiQuery({ name: 'createdBefore', required: false, description: 'RFC 3339 timestamp.' })
  @ApiQuery({ name: 'sort', required: false, enum: ['created', '-created', 'amount', '-amount'] })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'One based.' })
  @ApiQuery({ name: 'perPage', required: false, type: Number, description: 'At most 100.' })
  @ApiHeader({ name: 'X-Request-Id', required: false, description: 'Echoed back in the log.' })
  @ApiOkResponse({ type: OrderDto, isArray: true })
  @ApiResponse({ status: 400, description: 'A parameter did not parse.', type: ProblemDto })
  @ApiResponse({ status: 429, description: 'Too many requests.', type: ProblemDto })
  list(
    @Query('currency') currency?: string,
    @Query('status') status?: string,
    @Query('minAmount') minAmount?: string,
    @Query('maxAmount') maxAmount?: string,
  ): OrderDto[] {
    const wanted = status === undefined || status === '' ? [] : status.split(',');
    const least = minAmount === undefined ? 0 : Number(minAmount);
    const most = maxAmount === undefined ? Number.MAX_SAFE_INTEGER : Number(maxAmount);

    return ORDERS.filter(
      (order) => currency === undefined || currency === '' || order.currency === currency,
    )
      .filter((order) => wanted.length === 0 || wanted.includes(order.status))
      .filter((order) => order.amount >= least && order.amount <= most);
  }

  /**
   * The catalogue, which contains itself.
   *
   * @returns The top level categories, each carrying its own children
   */
  @Get('categories')
  @ApiOperation({
    summary: 'Read the category tree',
    description: 'A schema that refers to itself, so the tree has no declared depth.',
  })
  @ApiOkResponse({ type: CategoryDto, isArray: true })
  categories(): CategoryDto[] {
    return CATEGORIES;
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
  @ApiResponse({ status: 404, description: 'No order with that identifier.', type: ProblemDto })
  read(@Param('id') id: string): OrderDto {
    const found = ORDERS.find((order) => order.id === id);
    if (found !== undefined) return found;

    const template = ORDERS[0];

    return {
      id,
      amount: 0,
      currency: template.currency,
      status: 'draft',
      customer: template.customer,
      lines: [],
      payment: template.payment,
    };
  }

  /**
   * The receipt, which is not JSON.
   *
   * A reference that assumes every response is JSON renders this as an empty object. The
   * console has to show it as the text it is, and the browser has to be told not to sniff it.
   *
   * @param id - Identifier of the order
   * @returns The receipt as comma separated values
   */
  @Get(':id/receipt')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({ summary: 'Download the receipt', description: 'One row per order line.' })
  @ApiResponse({
    status: 200,
    description: 'The receipt.',
    content: {
      'text/csv': { schema: { type: 'string' }, example: 'sku,quantity\nsku_flute_c,2\n' },
    },
  })
  @ApiResponse({ status: 404, description: 'No order with that identifier.', type: ProblemDto })
  receipt(@Param('id') id: string): string {
    const order = this.read(id);
    const rows = order.lines.map(
      (line) => `${line.sku},${String(line.quantity)},${String(line.unitAmount)}`,
    );

    return ['sku,quantity,unitAmount', ...rows].join('\n') + '\n';
  }

  /**
   * Creates an order.
   *
   * SIX DOCUMENTED STATUS CODES. A real API answers more than 200, and what a reader wants from
   * a reference is the list, with a body shape against each one.
   *
   * @param body - Currency, lines and payment
   * @returns The created order
   */
  @Post()
  @ApiOperation({ summary: 'Create an order' })
  @ApiResponse({ status: 201, description: 'Created.', type: OrderDto })
  @ApiResponse({ status: 400, description: 'The body did not parse.', type: ProblemDto })
  @ApiResponse({ status: 402, description: 'The payment was declined.', type: ProblemDto })
  @ApiResponse({ status: 409, description: 'This order already exists.', type: ProblemDto })
  @ApiResponse({ status: 422, description: 'A line refers to an unknown sku.', type: ProblemDto })
  @ApiResponse({ status: 429, description: 'Too many requests.', type: ProblemDto })
  create(@Body() body: CreateOrderDto): OrderDto {
    // The body is whatever was posted. Nothing validates it here, because a validation pipe is
    // an opinion about the reader's application rather than about the reference.
    const lines = Array.isArray(body.lines) ? body.lines : [];

    return {
      id: `ord_${String(ORDERS.length + 1024)}`,
      amount: lines.reduce((total, line) => total + line.quantity * line.unitAmount, 0),
      currency: body.currency,
      status: 'draft',
      customer: ORDERS[0].customer,
      lines,
      payment: body.payment,
    };
  }
}
