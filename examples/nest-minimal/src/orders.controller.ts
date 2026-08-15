import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Sse,
  UnprocessableEntityException,
  UseGuards,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ApiAudience, ApiErrors, ApiSample, ApiScopes, ApiStream, paginated } from '@openref/nest';
import { from, map, type Observable } from 'rxjs';
import {
  ApiBody,
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
  OrderEventDto,
  ProblemDto,
  WalletPaymentDto,
} from './orders.dto.js';
import { OrderConflictError, OrderNotFoundError } from './orders.errors.js';
import { HeaderGuard, RequiresHeaders } from './orders.headers.js';
import { CurrencyPipe, TrimPipe } from './orders.pipes.js';
import { Scopes, ScopesGuard } from './orders.security.js';
import { RouteTimeout, TimeoutInterceptor } from './orders.timeout.js';

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

/**
 * A `ProblemDto` body for one documented error response.
 *
 * EVERY ERROR RESPONSE DECLARES ITS OWN EXAMPLE, AND EACH EXAMPLE STATES THE STATUS OF THE
 * RESPONSE IT SITS UNDER. The schema's own property examples cannot do this: they travel with
 * `ProblemDto` and are therefore identical under every response that references it, which is
 * how the demo once printed `order_conflict` with status 409 under both 400 and 429. An
 * example that contradicts the code above it is worse than none, because a reader copies it.
 */
function problem(status: number, title: string, detail: string): ProblemDto {
  return { status, title, detail };
}

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
 *
 * THE CONTROLLER IS GUARDED AND ONLY TWO ROUTES DECLARE SCOPES, AND THAT ASYMMETRY IS THE POINT
 * OF SPEC 6.1 RATHER THAN AN OVERSIGHT. `list` and `create` say what they need under a key the
 * application named, so the reference reports it. The other four are behind the same guard and say
 * nothing, so whatever the guard decides for them is written in code and will never be read: that
 * is the case `doctor` names, and it is the one state this project refuses to let look like a
 * route that needs no scopes at all.
 */
@ApiTags('orders')
@ApiExtraModels(CardPaymentDto, BankTransferDto, WalletPaymentDto)
@UseGuards(ScopesGuard)
// Every string input of every route is trimmed. Declared once here, which is the `route` scope
// of SPEC 6.2.1: the reference reports it on each operation, because it stands on each.
@UsePipes(TrimPipe)
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
  // The three facts of SPEC 6.2 that this application has to declare before anything can read
  // them: a scope under the application's own key, a rate limit the throttler enforces, and the
  // guard that enforces it. `@UseGuards(ThrottlerGuard)` is what makes the limit real; without it
  // `@Throttle` would be metadata describing an enforcement that does not happen, and a reference
  // reporting that would be exactly the guess this project does not make.
  @Scopes('orders:read')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseGuards(ThrottlerGuard)
  // The timeout pair, the same declare-and-enforce shape as the throttle above it: the number
  // is metadata under the application's own key, and the interceptor races the handler against
  // exactly that read, so what the reference reports is what runs.
  @RouteTimeout(5000)
  @UseInterceptors(TimeoutInterceptor)
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
  @ApiResponse({
    status: 400,
    description: 'A parameter did not parse.',
    type: ProblemDto,
    example: problem(400, 'invalid_parameter', 'minAmount is not a number.'),
  })
  @ApiResponse({
    status: 429,
    description: 'Too many requests.',
    type: ProblemDto,
    example: problem(429, 'rate_limited', 'More than 30 requests in a minute.'),
  })
  list(
    // The one parameter level pipe, the third scope of SPEC 6.2.1: `eur` matches the ISO code
    // the orders carry. The other five declared query parameters and the header are bound by
    // nothing, which is real drift the handler scan reports rather than fixture convenience.
    @Query('currency', CurrencyPipe) currency?: string,
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
   * The same orders, one page at a time.
   *
   * IT IS HERE FOR `paginated(OrderDto)`, WHICH IS SPEC 13.5's WHOLE POINT. `Page<OrderDto>` is
   * `Object` once TypeScript has compiled, so the usual answer is a hand written `OrderPageDto`
   * per inner type. The factory builds `PaginatedOrderDto` instead, deterministically, and the
   * schema is merged into the document at intake. There is deliberately no wrapper DTO in
   * `orders.dto.ts` to compare it against: one would be the thing this replaces.
   *
   * @returns The first page of orders
   */
  @Get('page')
  @ApiScopes('orders:read')
  @ApiOperation({ summary: 'List orders by page', description: 'The same orders, wrapped.' })
  @ApiOkResponse(paginated(OrderDto))
  page(): { items: OrderDto[]; total: number; page: number; perPage: number } {
    return { items: ORDERS, total: ORDERS.length, page: 1, perPage: 20 };
  }

  /**
   * Orders as they happen.
   *
   * THE ITEM TYPE IS DECLARED AND NOT REFLECTED, per SPEC 13.6. Nothing at runtime can recover
   * `OrderEventDto` from the return type of this method, so `@ApiStream` says it, the stream
   * collector reads it at `declared`, and a route that said nothing would be reported by `doctor`
   * rather than described with a guess.
   *
   * @returns One event per second, three of them, then the stream ends
   */
  @Sse('events')
  @ApiStream({ itemType: OrderEventDto, kind: 'sse', terminator: '[DONE]' })
  @ApiSample({
    lang: 'bash',
    label: 'curl',
    source: 'curl -N http://localhost:3000/orders/events',
  })
  @ApiOperation({ summary: 'Watch orders', description: 'One message per order event.' })
  events(): Observable<MessageEvent> {
    const events: OrderEventDto[] = ORDERS.map((order) => ({
      type: `order.${order.status}`,
      orderId: order.id,
      at: '2026-08-11T00:00:00Z',
    }));

    return from(events).pipe(map((data) => ({ data }) as MessageEvent));
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
  // THE DECLARATION AND THE OBSERVATION SIT SIDE BY SIDE HERE, WHICH IS THE POINT OF SPEC 6.4.
  // `@ApiErrors` is a promise this route makes, and it lands in the Declared group at `declared`.
  // The 401 and 403 that also appear on this route are not promises: they follow from `ScopesGuard`
  // standing in front of it, they land in the Runtime-derived group at `derived`, and nobody wrote
  // them down. Merging the two lists would make the reference unable to tell a reader which is
  // which, and that difference is the whole product.
  @ApiErrors(OrderNotFoundError)
  @ApiOperation({ summary: 'Read one order' })
  @ApiOkResponse({ type: OrderDto })
  @ApiResponse({
    status: 404,
    description: 'No order with that identifier.',
    type: ProblemDto,
    example: problem(404, 'order_not_found', 'No order exists with the identifier given.'),
  })
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
  // MARKED, NOT HIDDEN, per SPEC 13.4. The marking travels in the served specification as
  // `x-openref-audience`, where the agent surface of T058 is required to respect it. What keeps a
  // reference away from a reader is the visibility of the mounted document, which is a guard.
  @ApiAudience('internal')
  // The internal route really refuses without its token header, and the document says so with
  // `required: true`, so SP011 examines this operation and stays quiet. The guard checks
  // presence and not value, for the reason `orders.headers.ts` gives.
  @RequiresHeaders('X-Internal-Token')
  @UseGuards(HeaderGuard)
  @ApiHeader({
    name: 'X-Internal-Token',
    required: true,
    description: 'Any non-empty value. The internal surface refuses anonymous requests.',
    schema: { type: 'string', example: 'internal-demo' },
  })
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
  @ApiResponse({
    status: 404,
    description: 'No order with that identifier.',
    type: ProblemDto,
    example: problem(404, 'order_not_found', 'No order exists with the identifier given.'),
  })
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
  // A METHOD'S SCOPES REPLACE A CLASS'S RATHER THAN ADDING TO THEM, which is why writing is
  // spelled out here instead of being assumed on top of reading.
  @Scopes('orders:write')
  // Explicit where it was implicit: POST answers 201 by framework default, and the decorator
  // turns the default into a decision written on the route, which is the only thing
  // `httpCodeCollector` reads. The documented 201 above agrees, so SP012 examines and is quiet.
  @HttpCode(201)
  // Declared through a class carrying its own static `status` rather than through the catalog,
  // which is the second level of SPEC 6.4 and the one an application with a base error class gets
  // for free.
  @ApiErrors(OrderConflictError)
  @ApiOperation({ summary: 'Create an order' })
  @ApiResponse({ status: 201, description: 'Created.', type: OrderDto })
  @ApiResponse({
    status: 400,
    description: 'The body did not parse.',
    type: ProblemDto,
    example: problem(400, 'invalid_body', 'The request carried no body that parses as an order.'),
  })
  @ApiResponse({
    status: 402,
    description: 'The payment was declined.',
    type: ProblemDto,
    example: problem(402, 'payment_declined', 'The card issuer refused the charge.'),
  })
  @ApiResponse({
    status: 409,
    description: 'This order already exists.',
    type: ProblemDto,
    example: problem(409, 'order_conflict', 'An order with this idempotency key already exists.'),
  })
  @ApiResponse({
    status: 422,
    description: 'A line refers to an unknown sku.',
    type: ProblemDto,
    example: problem(422, 'unknown_sku', 'sku_flute_h is not in the catalogue.'),
  })
  @ApiResponse({
    status: 429,
    description: 'Too many requests.',
    type: ProblemDto,
    example: problem(429, 'rate_limited', 'More than 30 requests in a minute.'),
  })
  create(@Body() body?: CreateOrderDto): OrderDto {
    // NOT A VALIDATION PIPE, WHICH REMAINS AN OPINION ABOUT THE READER'S APPLICATION, but the
    // route's own honesty about the answer it documents. An empty POST reaches this handler as
    // no body at all, Express 5 leaves `req.body` undefined when no parser matched, and the
    // demo answered its documented 400 with an Internal Server Error instead: the first thing
    // a person runs, failing on the second operation they try. A required schema with nothing
    // sent is the 400 this route declares, in the ProblemDto shape it declares for it.
    if (body === undefined || typeof body.currency !== 'string' || !Array.isArray(body.lines)) {
      throw new BadRequestException(
        problem(400, 'invalid_body', 'The request carried no body that parses as an order.'),
      );
    }

    return {
      id: `ord_${String(ORDERS.length + 1024)}`,
      amount: body.lines.reduce((total, line) => total + line.quantity * line.unitAmount, 0),
      currency: body.currency,
      status: 'draft',
      customer: ORDERS[0].customer,
      lines: body.lines,
      payment: body.payment,
    };
  }

  /**
   * Accepts a payment instruction for an order.
   *
   * THE BODY IS THE VALUE DEPENDENT SHAPES FIXTURE of `orders.payment.ts`: its shape depends
   * on the values inside it, and the schema is registered raw on the document because the
   * decorator DSL has no conditional vocabulary. The reference to it from here is an ordinary
   * `$ref`, which is all a route has to say about a body the classes cannot express.
   *
   * @param id - Identifier of the order the instruction pays
   * @param instruction - The instruction, in whichever of its shapes the values select
   * @returns Acceptance, since collection happens later
   */
  @Post(':id/payment')
  @Scopes('orders:write')
  // Explicit where it was implicit, the `create` rule: acceptance without collection is 202,
  // the decorator writes the decision on the route, and the documented 202 below agrees, so
  // SP012 examines and is quiet.
  @HttpCode(202)
  @ApiErrors(OrderNotFoundError)
  @ApiOperation({
    summary: 'Submit a payment instruction',
    description:
      'The shape of the body depends on the values inside it. The method selects a branch, ' +
      'the country decides whether a postal code is required, and the amount decides whether ' +
      'the card branch must carry a 3-D Secure block.',
  })
  @ApiBody({
    description: 'How to pay for the order.',
    schema: { $ref: '#/components/schemas/PaymentInstruction' },
    examples: {
      card: {
        summary: 'A card above the 3-D Secure line',
        value: {
          amountMinor: 7400,
          currency: 'USD',
          country: 'US',
          postalCode: '20003',
          method: 'card',
          pan: '4111111111111111',
          holder: 'ACME GmbH',
          threeDSecure: { version: '2.2.0' },
          metadata: { 'x-cost-center': 'AC-4417' },
          geo: [38.8977, -77.0365],
        },
      },
    },
  })
  @ApiResponse({
    status: 202,
    description: 'Accepted. Collection happens asynchronously.',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            status: { type: 'string', description: 'Always accepted here.' },
            orderId: { type: 'string', description: 'The order the instruction pays.' },
          },
          required: ['status', 'orderId'],
        },
        example: { status: 'accepted', orderId: 'ord_1024' },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'No order with that identifier.',
    type: ProblemDto,
    example: problem(404, 'order_not_found', 'No order exists with the identifier given.'),
  })
  @ApiResponse({
    status: 422,
    description: 'The values select no branch of the body.',
    type: ProblemDto,
    example: problem(
      422,
      'instruction_invalid',
      'The instruction names no known method, so no branch of the body applies.',
    ),
  })
  submitPayment(
    @Param('id') id: string,
    @Body() instruction?: Record<string, unknown>,
  ): { status: string; orderId: string } {
    const order = ORDERS.find((entry) => entry.id === id);
    if (order === undefined) {
      throw new NotFoundException(
        problem(404, 'order_not_found', 'No order exists with the identifier given.'),
      );
    }

    // The route's own honesty about the answer it documents, the `create` rule: the documented
    // 422 is answered for real, on the same check the schema states as the leading value.
    const method = instruction?.method;
    if (
      typeof method !== 'string' ||
      !['card', 'bank_transfer', 'wallet', 'invoice'].includes(method)
    ) {
      throw new UnprocessableEntityException(
        problem(
          422,
          'instruction_invalid',
          'The instruction names no known method, so no branch of the body applies.',
        ),
      );
    }

    return { status: 'accepted', orderId: id };
  }
}
