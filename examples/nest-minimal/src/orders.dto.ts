import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';

/**
 * The shapes the demo exists to render.
 *
 * A hello world API proves a renderer draws a box. What a reader is deciding between here is
 * OPENREF and a tool that has drawn boxes for years, so the surface deliberately carries the
 * five things that separate them: nesting several levels deep, a `oneOf` with a discriminator,
 * a schema that refers to itself, an operation with more parameters than fit on a line, and a
 * response that is not JSON. Each one is a place a reference either works or quietly gives up.
 *
 * IT IS A REAL API AND NOT A FIXTURE. Every operation answers, so the try-it console sends to
 * this application and gets an answer back, per SPEC 2.
 */

/** A point on the earth. The fourth level of nesting, counted from an order. */
export class GeoDto {
  @ApiProperty({ description: 'Degrees north of the equator.', example: 52.370216 })
  latitude!: number;

  @ApiProperty({ description: 'Degrees east of the meridian.', example: 4.895168 })
  longitude!: number;
}

/** A postal address. */
export class AddressDto {
  @ApiProperty({ description: 'Street and number.', example: 'Prinsengracht 263' })
  line1!: string;

  @ApiProperty({ description: 'City or town.', example: 'Amsterdam' })
  city!: string;

  @ApiProperty({
    description: 'Postal code, in whatever form the country uses.',
    example: '1016 GV',
  })
  postalCode!: string;

  @ApiProperty({ description: 'ISO 3166-1 alpha-2 country code.', example: 'NL' })
  country!: string;

  @ApiProperty({ description: 'Where the address is, when it is known.', required: false })
  geo?: GeoDto;
}

/** Who placed the order. */
export class CustomerDto {
  @ApiProperty({ description: 'Identifier of the customer.', example: 'cus_88' })
  id!: string;

  @ApiProperty({ description: 'Where receipts are sent.', example: 'ada@example.com' })
  email!: string;

  @ApiProperty({ description: 'The address the invoice carries.' })
  billingAddress!: AddressDto;
}

/**
 * A category, which contains categories.
 *
 * THE RECURSION IS THE POINT. `children` refers to this class, so the resolved schema is a
 * cycle, and a reference that expands references without noticing one either hangs or draws an
 * infinite tree. The lazy `type` is how `@nestjs/swagger` is told about a class from inside its
 * own body.
 */
export class CategoryDto {
  @ApiProperty({ description: 'Stable identifier used in paths.', example: 'instruments' })
  slug!: string;

  @ApiProperty({ description: 'What to show a reader.', example: 'Instruments' })
  title!: string;

  @ApiProperty({
    description: 'Categories directly under this one.',
    type: () => [CategoryDto],
    required: false,
  })
  children?: CategoryDto[];
}

/** Paid with a card. */
export class CardPaymentDto {
  @ApiProperty({ description: 'Discriminator.', enum: ['card'], example: 'card' })
  kind!: 'card';

  @ApiProperty({ description: 'Last four digits, which is all that is kept.', example: '4242' })
  last4!: string;

  @ApiProperty({ description: 'Card network.', enum: ['visa', 'mastercard', 'amex'] })
  network!: 'visa' | 'mastercard' | 'amex';
}

/** Paid by transfer. */
export class BankTransferDto {
  @ApiProperty({ description: 'Discriminator.', enum: ['bank_transfer'], example: 'bank_transfer' })
  kind!: 'bank_transfer';

  @ApiProperty({ description: 'Account the money came from.', example: 'NL91ABNA0417164300' })
  iban!: string;

  @ApiProperty({ description: 'What the payer wrote on the transfer.', example: 'ord_1024' })
  reference!: string;
}

/** Paid from a wallet. */
export class WalletPaymentDto {
  @ApiProperty({ description: 'Discriminator.', enum: ['wallet'], example: 'wallet' })
  kind!: 'wallet';

  @ApiProperty({ description: 'Which wallet.', enum: ['apple_pay', 'google_pay'] })
  provider!: 'apple_pay' | 'google_pay';

  @ApiProperty({ description: 'Identifier inside that wallet.', example: 'wal_7' })
  walletId!: string;
}

/** Any of the three ways an order is paid for. */
export type PaymentDto = BankTransferDto | CardPaymentDto | WalletPaymentDto;

/**
 * The `oneOf` with a discriminator, written once and used by three operations.
 *
 * The mapping is what lets a reader see three named alternatives rather than one union of
 * everything, and it is what a client generator needs to pick a type from `kind`.
 */
const PAYMENT_SCHEMA = {
  oneOf: [
    { $ref: getSchemaPath(CardPaymentDto) },
    { $ref: getSchemaPath(BankTransferDto) },
    { $ref: getSchemaPath(WalletPaymentDto) },
  ],
  discriminator: {
    propertyName: 'kind',
    mapping: {
      card: getSchemaPath(CardPaymentDto),
      bank_transfer: getSchemaPath(BankTransferDto),
      wallet: getSchemaPath(WalletPaymentDto),
    },
  },
};

/** One line of an order. */
export class OrderLineDto {
  @ApiProperty({ description: 'Stock keeping unit.', example: 'sku_flute_c' })
  sku!: string;

  @ApiProperty({ description: 'How many.', example: 2, minimum: 1 })
  quantity!: number;

  @ApiProperty({ description: 'Price of one, in minor units.', example: 2250 })
  unitAmount!: number;

  @ApiProperty({ description: 'Where this line sits in the catalogue.' })
  category!: CategoryDto;
}

/** One order, as the API returns it. */
@ApiExtraModels(CardPaymentDto, BankTransferDto, WalletPaymentDto)
export class OrderDto {
  @ApiProperty({
    description: 'Identifier of the order. The server assigns it, so no request carries one.',
    example: 'ord_1024',
    readOnly: true,
  })
  id!: string;

  @ApiProperty({ description: 'Total in minor units.', example: 4500 })
  amount!: number;

  @ApiProperty({ description: 'ISO 4217 currency code.', example: 'EUR' })
  currency!: string;

  @ApiProperty({
    description: 'Where the order is in its life.',
    enum: ['draft', 'placed', 'shipped', 'refunded'],
    example: 'placed',
  })
  status!: 'draft' | 'placed' | 'refunded' | 'shipped';

  @ApiProperty({ description: 'Who placed it, with their address inside.' })
  customer!: CustomerDto;

  @ApiProperty({ description: 'What was ordered.', type: [OrderLineDto] })
  lines!: OrderLineDto[];

  @ApiProperty({ description: 'How it was paid for.', ...PAYMENT_SCHEMA })
  payment!: PaymentDto;
}

/** What creating an order needs. */
@ApiExtraModels(CardPaymentDto, BankTransferDto, WalletPaymentDto)
export class CreateOrderDto {
  @ApiProperty({ description: 'ISO 4217 currency code.', example: 'EUR' })
  currency!: string;

  @ApiProperty({ description: 'What is being ordered.', type: [OrderLineDto] })
  lines!: OrderLineDto[];

  @ApiProperty({ description: 'How it will be paid for.', ...PAYMENT_SCHEMA })
  payment!: PaymentDto;
}

/**
 * What every failure of this API looks like.
 *
 * One shape for every documented status code, which is what makes a list of six of them worth
 * reading rather than six guesses about what comes back.
 */
/**
 * NO PROPERTY EXAMPLES, AND THAT IS A LESSON RATHER THAN AN OMISSION. A property example
 * travels with the schema, so it is identical under every response that references it: the
 * `409` this class used to carry was printed under 400 and under 429, contradicting both.
 * Each response declares its own `example` at the media type instead, where a status can be
 * the status of the response it sits under.
 */
export class ProblemDto {
  @ApiProperty({ description: 'The status code, repeated in the body.' })
  status!: number;

  @ApiProperty({ description: 'Short, stable, safe to switch on.' })
  title!: string;

  @ApiProperty({ description: 'What went wrong this time, for a person.' })
  detail!: string;
}

/**
 * One event on the order stream.
 *
 * IT EXISTS BECAUSE A STREAM CANNOT SAY WHAT IT CARRIES BY ITSELF. `Observable<MessageEvent<
 * OrderEventDto>>` is `Observable` once TypeScript has compiled, so the item type of the SSE route
 * is declared with `@ApiStream({ itemType: OrderEventDto })` and read from there, per SPEC 13.6.
 */
export class OrderEventDto {
  @ApiProperty({ description: 'What happened.', example: 'order.shipped' })
  type!: string;

  @ApiProperty({ description: 'Which order it happened to.', example: 'ord_1024' })
  orderId!: string;

  @ApiProperty({ description: 'When, as an RFC 3339 timestamp.' })
  at!: string;
}
