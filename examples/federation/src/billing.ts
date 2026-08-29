import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from './guards.js';

/**
 * The local service of the federation, per SPEC 15.3.
 *
 * IT LIVES IN THE GATEWAY PROCESS, WHICH IS WHY IT IS THE ONE WITH RUNTIME FACTS: the runtime
 * pass of SPEC 6 reads this process's own controllers, and a remote is fetched as a
 * specification and carries none. The drift is real and deliberate: `create` is guarded and
 * declares no security in the specification below, which is exactly the silence
 * `security-drift` exists for, so the billing service card shows a finding a reader can act on.
 */

interface ChargeInput {
  readonly amount?: number;
  readonly currency?: string;
}

@Controller('charges')
@UseGuards(ApiKeyGuard)
export class BillingController {
  @Get()
  list(): { charges: readonly { id: string; amount: number }[] } {
    return { charges: [{ id: 'ch_1', amount: 1250 }] };
  }

  @Post()
  create(@Body() body: ChargeInput): { id: string; amount: number; currency: string } {
    return { id: 'ch_2', amount: body.amount ?? 0, currency: body.currency ?? 'EUR' };
  }
}

/**
 * Billing's specification, written by hand rather than by `SwaggerModule`.
 *
 * A HANDWRITTEN DOCUMENT IS WHAT LETS `forRoot` MOUNT IT: `documents` entries are read before
 * the application exists, per SPEC 13.2, and a federation naming this service as local needs it
 * mounted in that same hook. The server is `/`, the honest address of an API that ships its own
 * gateway: the console sends to wherever the page is served from.
 */
export function billingSpecification(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Billing',
      version: '1.4.0',
      description: 'Charges and refunds. This service lives inside the gateway process.',
    },
    servers: [{ url: '/' }],
    components: {
      securitySchemes: { apiKey: { type: 'apiKey', in: 'header', name: 'X-Api-Key' } },
    },
    paths: {
      '/charges': {
        get: {
          operationId: 'listCharges',
          summary: 'List charges',
          security: [{ apiKey: [] }],
          responses: { '200': { description: 'A page of charges' } },
        },
        post: {
          operationId: 'createCharge',
          summary: 'Create a charge',
          // No security declared, deliberately: the guard is real and the document is silent,
          // which is the security-drift finding the service card surfaces.
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    amount: { type: 'integer' },
                    currency: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Created' } },
        },
      },
    },
  };
}
