/**
 * The value dependent shapes fixture: a payment instruction whose shape depends on the values
 * inside it, per SPEC 5.4 and the shapes page of SPEC 11.
 *
 * THE WALL THIS FILE STANDS AT IS REAL. The decorator DSL of `@nestjs/swagger` has no
 * vocabulary for `if`/`then`/`else`, `dependentRequired`, `patternProperties` or
 * `prefixItems`, so an application that needs them writes the schemas raw and registers them
 * on the document it owns, after `createDocument` and before handing it over. That is not a
 * convenience invented for this demo: it is the post processing any real NestJS application
 * is forced into on the day its body stops being expressible as a class, and the demo does it
 * the way a real application does, on the document object `main.ts` already holds.
 *
 * WHAT THE FIXTURE CARRIES, each construct at the position a real API puts it:
 *
 * - `if`/`then`/`else` at the instruction root: `postalCode` is required only when `country`
 *   is `US`, with a ZIP pattern under the condition and a loose bound otherwise
 * - a second conditional inside the card branch, naming a field of the root: `threeDSecure`
 *   is required only when `amountMinor` is above 5000
 * - a `oneOf` of four named variants under a `discriminator`, selected by `method`
 * - `dependentRequired` inside the bank variant: a `bic` alone is not enough, naming the bank
 * - a `oneOf` nested inside a `oneOf` branch: invoice terms, whose milestone branch carries
 *   the schedule `oneOf`, third level down
 * - `patternProperties` on `metadata`, keys under `^x-`
 * - a closed coordinate tuple: `prefixItems` with `items: false`
 */

/** Reference into the document's own schema map, the way the raw payment `oneOf` writes one. */
function ref(name: string): { readonly $ref: string } {
  return { $ref: `#/components/schemas/${name}` };
}

/**
 * The named schemas of the fixture, keyed by the name each takes in `components.schemas`.
 *
 * `PaymentInstruction` is the root the operation's body references; everything else is a
 * branch it reaches by reference, so the reference pages can name and link them.
 */
export const PAYMENT_INSTRUCTION_SCHEMAS: Readonly<Record<string, unknown>> = {
  PaymentInstruction: {
    type: 'object',
    description:
      'How an order is to be paid. The shape depends on the values inside it: the method ' +
      'selects one of four branches, the country decides whether a postal code is required, ' +
      'and the amount decides whether the card branch must carry a 3-D Secure block.',
    properties: {
      amountMinor: {
        type: 'integer',
        minimum: 1,
        description: 'Amount to collect, in minor units of the currency.',
      },
      currency: {
        type: 'string',
        enum: ['EUR', 'USD', 'GBP', 'CHF'],
        description: 'ISO 4217 currency code.',
      },
      country: {
        type: 'string',
        enum: ['US', 'DE', 'GB', 'CH'],
        description: 'Country the payer is charged in.',
      },
      postalCode: {
        type: 'string',
        description: 'Postal code of the payer. Whether it is required depends on the country.',
      },
      method: {
        type: 'string',
        enum: ['card', 'bank_transfer', 'wallet', 'invoice'],
        description: 'Leading value: selects which branch the rest of the body must satisfy.',
      },
      metadata: {
        type: 'object',
        description: 'Free annotations, keys under the x- pattern.',
        patternProperties: {
          '^x-[a-z0-9_]{2,32}$': { type: 'string', maxLength: 500 },
        },
        additionalProperties: false,
      },
      geo: {
        type: 'array',
        description: 'Where the instruction was issued, as a closed coordinate pair.',
        prefixItems: [
          { type: 'number', title: 'latitude', minimum: -90, maximum: 90 },
          { type: 'number', title: 'longitude', minimum: -180, maximum: 180 },
        ],
        items: false,
      },
    },
    required: ['amountMinor', 'currency', 'country', 'method'],
    if: { properties: { country: { const: 'US' } }, required: ['country'] },
    then: {
      required: ['postalCode'],
      properties: { postalCode: { pattern: '^[0-9]{5}(-[0-9]{4})?$' } },
    },
    else: { properties: { postalCode: { maxLength: 12 } } },
    oneOf: [
      ref('CardMethod'),
      ref('BankTransferMethod'),
      ref('WalletMethod'),
      ref('InvoiceMethod'),
    ],
    discriminator: {
      propertyName: 'method',
      mapping: {
        card: '#/components/schemas/CardMethod',
        bank_transfer: '#/components/schemas/BankTransferMethod',
        wallet: '#/components/schemas/WalletMethod',
        invoice: '#/components/schemas/InvoiceMethod',
      },
    },
  },

  CardMethod: {
    type: 'object',
    title: 'card',
    description: 'Charge a card. Above 5000 minor units the instruction must carry 3-D Secure.',
    properties: {
      method: { const: 'card', description: 'Discriminator.' },
      pan: {
        type: 'string',
        minLength: 13,
        maxLength: 19,
        description: 'Primary account number.',
      },
      holder: { type: 'string', description: 'Name on the card.' },
      threeDSecure: {
        type: 'object',
        description: 'Strong customer authentication block.',
        properties: {
          version: { type: 'string', enum: ['2.1.0', '2.2.0'], description: 'Protocol version.' },
        },
        required: ['version'],
      },
    },
    required: ['method', 'pan', 'holder'],
    // The condition names a field of the root instance, which a branch of the root oneOf is
    // evaluated against; that reach across is the point of the fixture.
    if: { properties: { amountMinor: { exclusiveMinimum: 5000 } }, required: ['amountMinor'] },
    then: { required: ['threeDSecure'] },
  },

  BankTransferMethod: {
    type: 'object',
    title: 'bank_transfer',
    description: 'Pull the amount by transfer. A BIC alone is not enough: name the bank.',
    properties: {
      method: { const: 'bank_transfer', description: 'Discriminator.' },
      iban: { type: 'string', description: 'Account to pull from.' },
      bic: { type: 'string', description: 'Bank identifier, when the IBAN is not enough.' },
      bankName: { type: 'string', description: 'Name of the bank the BIC identifies.' },
    },
    required: ['method', 'iban'],
    dependentRequired: { bic: ['bankName'] },
  },

  WalletMethod: {
    type: 'object',
    title: 'wallet',
    description: 'Charge a wallet.',
    properties: {
      method: { const: 'wallet', description: 'Discriminator.' },
      provider: {
        type: 'string',
        enum: ['apple_pay', 'google_pay'],
        description: 'Which wallet.',
      },
      walletToken: { type: 'string', description: 'Opaque token the wallet issued.' },
    },
    required: ['method', 'provider', 'walletToken'],
  },

  InvoiceMethod: {
    type: 'object',
    title: 'invoice',
    description: 'Invoice the customer under agreed terms.',
    properties: {
      method: { const: 'invoice', description: 'Discriminator.' },
      invoiceNumber: { type: 'string', description: 'Number to print on the invoice.' },
      terms: {
        description: 'Payment terms. The kind selects the shape of the rest.',
        oneOf: [ref('MilestoneTerms'), ref('NetTerms'), ref('PrepaidTerms')],
        discriminator: {
          propertyName: 'kind',
          mapping: {
            milestone: '#/components/schemas/MilestoneTerms',
            net: '#/components/schemas/NetTerms',
            prepaid: '#/components/schemas/PrepaidTerms',
          },
        },
      },
    },
    required: ['method', 'terms'],
  },

  MilestoneTerms: {
    type: 'object',
    title: 'milestone',
    description: 'Paid in parts as milestones complete. The schedule itself branches again.',
    properties: {
      kind: { const: 'milestone', description: 'Discriminator.' },
      schedule: {
        description: 'How the parts are laid out: by dates or by percentages.',
        oneOf: [
          {
            type: 'object',
            title: 'by dates',
            properties: {
              basis: { const: 'dates', description: 'Discriminator.' },
              dates: {
                type: 'array',
                items: { type: 'string', format: 'date' },
                minItems: 1,
                description: 'When each part falls due.',
              },
            },
            required: ['basis', 'dates'],
          },
          {
            type: 'object',
            title: 'by percent',
            properties: {
              basis: { const: 'percent', description: 'Discriminator.' },
              percentages: {
                type: 'array',
                items: { type: 'number', minimum: 1, maximum: 100 },
                minItems: 1,
                description: 'Share of the amount per part, in percent.',
              },
            },
            required: ['basis', 'percentages'],
          },
        ],
      },
    },
    required: ['kind', 'schedule'],
  },

  NetTerms: {
    type: 'object',
    title: 'net',
    description: 'Paid in full a fixed number of days after the invoice date.',
    properties: {
      kind: { const: 'net', description: 'Discriminator.' },
      days: { type: 'integer', minimum: 1, maximum: 90, description: 'Days until due.' },
    },
    required: ['kind', 'days'],
  },

  PrepaidTerms: {
    type: 'object',
    title: 'prepaid',
    description: 'Already paid; the invoice only records it.',
    properties: {
      kind: { const: 'prepaid', description: 'Discriminator.' },
    },
    required: ['kind'],
  },
};

/** The shape of the one part of the document this file touches. */
interface DocumentWithSchemas {
  components?: { schemas?: Record<string, unknown> };
}

/**
 * Registers the fixture schemas on the document the application built.
 *
 * Refuses a name that already exists rather than overwriting it, for the reason the synthetic
 * schema registry refuses one: a silent overwrite is a document that no longer says what its
 * classes say.
 *
 * @param document - The OpenAPI document `createDocument` returned, owned by the application
 */
export function registerPaymentInstructionSchemas(document: DocumentWithSchemas): void {
  const components = (document.components ??= {});
  const schemas = (components.schemas ??= {});

  for (const [name, schema] of Object.entries(PAYMENT_INSTRUCTION_SCHEMAS)) {
    if (Object.hasOwn(schemas, name)) {
      throw new Error(`schema ${name} is already declared by the application`);
    }
    schemas[name] = schema;
  }
}
