import { normalizeOpenApiDocument, type IRDocument } from '@openref/core';
import { mergeDocuments } from '@openref/federation';
import { createRunner, type RequestPlan, type TransportResponse } from '@openref/runner';
import { runnerOperationOf } from '@openref/vue';
import type { RunnerOperationView } from '@openref/vue';
import { describe, expect, it } from 'vitest';

/**
 * One credential session across services, per SPEC 15.3 and `T046`, asserted rather than
 * assumed.
 *
 * THE ISOLATION IS BY CONSTRUCTION AND THE SUITE STILL SENDS THE REQUEST. Two services that
 * declare one scheme name with two configurations get two scheme ids out of the merge, per
 * SPEC 15, and the runner reads the store only for the ids an operation's own `security`
 * names. Both halves are real code with a history of quiet regressions elsewhere, so the
 * proof is the wire shape: the request that must carry the credential is asserted to carry it
 * first, and only then is its absence on the other service's request evidence of anything.
 */

/** Captures every plan the runner sends, answering 200 so `send` settles. */
class CapturingTransport {
  public readonly plans: RequestPlan[] = [];

  send(plan: RequestPlan): Promise<TransportResponse> {
    this.plans.push(plan);
    return Promise.resolve({ status: 200, statusText: 'OK', headers: [], body: '{}' });
  }

  last(): RequestPlan {
    const plan = this.plans[this.plans.length - 1];
    if (plan === undefined) throw new Error('nothing was sent');
    return plan;
  }
}

/** Billing: an `auth` scheme that is an api key in a header. */
function billingService(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: { title: 'Billing', version: '1.0.0' },
    servers: [{ url: 'https://billing.internal' }],
    components: {
      securitySchemes: { auth: { type: 'apiKey', in: 'header', name: 'X-Api-Key' } },
    },
    paths: {
      '/charges': {
        post: {
          operationId: 'createCharge',
          security: [{ auth: [] }],
          responses: { '201': { description: 'created' } },
        },
      },
    },
  };
}

/** Orders: an `auth` scheme of the same name that is bearer HTTP instead. */
function ordersService(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: { title: 'Orders', version: '2.0.0' },
    servers: [{ url: 'https://orders.internal' }],
    components: { securitySchemes: { auth: { type: 'http', scheme: 'bearer' } } },
    paths: {
      '/orders': {
        get: {
          operationId: 'listOrders',
          security: [{ auth: [] }],
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  };
}

interface Federation {
  readonly document: IRDocument;
  readonly billingOp: RunnerOperationView;
  readonly ordersOp: RunnerOperationView;
}

function federation(): Federation {
  const { document } = mergeDocuments(
    [
      { id: 'billing', document: normalizeOpenApiDocument(billingService()) },
      { id: 'orders', document: normalizeOpenApiDocument(ordersService()) },
    ],
    { id: 'gateway', info: { title: 'Gateway', version: '1.0.0' } },
  );

  const billing = document.nodes.get('billing_post-charges');
  const orders = document.nodes.get('orders_get-orders');
  if (billing?.kind !== 'operation' || orders?.kind !== 'operation') {
    throw new Error(`the merged node ids moved: ${[...document.nodes.keys()].sort().join(', ')}`);
  }

  return {
    document,
    billingOp: runnerOperationOf(billing, document),
    ordersOp: runnerOperationOf(orders, document),
  };
}

describe('credentials across federated services', () => {
  it('should give two same-named schemes of two services two scheme ids', () => {
    // Given
    const { billingOp, ordersOp } = federation();

    // When
    const billingScheme = billingOp.security[0]?.id;
    const ordersScheme = ordersOp.security[0]?.id;

    // Then: the separation the isolation below stands on is data, not luck
    expect(billingScheme).toBeDefined();
    expect(ordersScheme).toBeDefined();
    expect(billingScheme).not.toBe(ordersScheme);
  });

  it('should offer each operation its own service servers, per SPEC 15.3', () => {
    // Given: the merged document is served with no servers of its own, per SPEC 15.1
    const { document, billingOp, ordersOp } = federation();
    expect(document.servers).toEqual([]);

    // When / Then: the console's server list is the service's, never another service's
    expect(billingOp.servers).toEqual(['https://billing.internal']);
    expect(ordersOp.servers).toEqual(['https://orders.internal']);
  });

  it('should apply a credential to its own service and never to the other one', async () => {
    // Given: one runner, which is one session for the whole page, per SPEC 15.3
    const { billingOp, ordersOp } = federation();
    const transport = new CapturingTransport();
    const runner = createRunner({ visibility: 'public', storage: 'memory', transport });
    const billingScheme = billingOp.security[0]?.id ?? '';
    runner.setCredential(billingScheme, 'billing-secret');

    // And presence first: the billing request really carries the credential, so the absence
    // below is a fact about isolation rather than about a credential nothing applied
    await runner.send({ operation: billingOp, serverUrl: 'https://billing.internal', values: {} });
    expect(transport.last().headers['X-Api-Key']).toBe('billing-secret');

    // When: the other service's operation is sent in the same session
    await runner.send({ operation: ordersOp, serverUrl: 'https://orders.internal', values: {} });

    // Then: nothing of billing's credential crosses, under any header
    const plan = transport.last();
    expect(plan.headers['X-Api-Key']).toBeUndefined();
    expect(Object.values(plan.headers)).not.toContain('billing-secret');
    expect(Object.values(plan.headers).some((value) => value.includes('billing-secret'))).toBe(
      false,
    );
  });

  it('should carry each credential on its own service once both are signed in', async () => {
    // Given
    const { billingOp, ordersOp } = federation();
    const transport = new CapturingTransport();
    const runner = createRunner({ visibility: 'public', storage: 'memory', transport });
    runner.setCredential(billingOp.security[0]?.id ?? '', 'billing-secret');
    runner.setCredential(ordersOp.security[0]?.id ?? '', 'orders-token');

    // When
    await runner.send({ operation: billingOp, serverUrl: 'https://billing.internal', values: {} });
    const billingPlan = transport.last();
    await runner.send({ operation: ordersOp, serverUrl: 'https://orders.internal', values: {} });
    const ordersPlan = transport.last();

    // Then: one session, two services, each request shaped by its own scheme alone
    expect(billingPlan.headers['X-Api-Key']).toBe('billing-secret');
    expect(billingPlan.headers.Authorization).toBeUndefined();
    expect(ordersPlan.headers.Authorization).toBe('Bearer orders-token');
    expect(ordersPlan.headers['X-Api-Key']).toBeUndefined();
  });
});
