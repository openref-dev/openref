import { describe, expect, it } from 'vitest';
import type { IRDocument, IRNavNode } from '@openref/core';
import { buildNavigation, buildPageModel } from '../../src/page/domain/page-model';
import {
  renderPage,
  serializePageModel,
} from '../../src/render/application/services/render.service';
import { createMarkdownRenderer } from '../../src/markdown/domain/markdown';
import { smallDocument } from '../mocks/documents';

const markdown = await createMarkdownRenderer();

/**
 * The federated service card of SPEC 15.3, at the model and the markup.
 *
 * THE FIXTURE IS A MERGED SHAPE BUILT BY HAND, not by the merge engine: this package cannot see
 * `@openref/federation` per STANDARDS 3.5, and what these cases hold is the renderer's reading
 * of `IRDocument.services`, `IRNode.serviceId` and `IRNavNode.serviceId`, whose construction is
 * that package's own suite.
 */

const SERVICE_HASH = 'c'.repeat(64);

function federatedDocument(): IRDocument {
  const base = smallDocument();
  const group: IRNavNode = {
    id: 'group-service-billing',
    label: 'Billing',
    kind: 'group',
    serviceId: 'billing',
    children: base.navigation,
  };

  return {
    ...base,
    navigation: [group],
    nodes: new Map([...base.nodes].map(([id, node]) => [id, { ...node, serviceId: 'billing' }])),
    services: [
      {
        id: 'billing',
        documentId: base.id,
        documentHash: SERVICE_HASH,
        kind: 'http',
        info: {
          title: 'Billing',
          version: '3.2.1',
          description: 'The billing service, **merged**.',
        },
        servers: [{ url: 'https://billing.internal' }],
        prefix: '/billing',
        runtime: { collectors: ['guardsCollector', 'throttlerCollector'] },
        health: {
          score: 88,
          operationCount: 2,
          checks: [
            {
              id: 'security-drift',
              label: 'Security matches the guards',
              total: 2,
              passed: 1,
              severity: 'warning',
            },
          ],
          drift: [
            {
              rule: 'security-drift',
              severity: 'warning',
              message: 'The guard names a scheme the document does not.',
              nodeId: [...base.nodes.keys()][0] ?? '',
              suggestion: 'declare the scheme on the operation',
              classification: { bucket: 'silence' },
              edit: 'new-assertion',
              basis: { kind: 'collected', confidence: 'declared' },
            },
          ],
        },
      },
    ],
  };
}

describe('the service page model', () => {
  it('should build the card from what the service said about itself', () => {
    // Given
    const document = federatedDocument();

    // When
    const model = buildPageModel(document, {
      page: 'service',
      serviceId: 'billing',
      markdown,
    });

    // Then
    expect(model.kind).toBe('service');
    const service = model.service;
    expect(service?.id).toBe('billing');
    expect(service?.title).toBe('Billing');
    expect(service?.version).toBe('3.2.1');
    expect(service?.prefix).toBe('/billing');
    expect(service?.servers).toEqual(['https://billing.internal']);
    expect(service?.documentHash).toBe(SERVICE_HASH);
    expect(service?.operations).toBe(document.nodes.size);
    expect(service?.collectors).toEqual(['guardsCollector', 'throttlerCollector']);
    expect(model.frame.crumb).toBe('Services / Billing');
  });

  it('should draw the service own health report, never the merged document one', () => {
    // Given: the merged document carries no report while the service carries its own, so a
    // fallthrough to the document would show nothing and a fallthrough the other way is the
    // case guarded in the builder
    const document = federatedDocument();
    expect(document.health).toBeUndefined();

    // When
    const model = buildPageModel(document, {
      page: 'service',
      serviceId: 'billing',
      markdown,
    });

    // Then
    expect(model.service?.healthRendered).toBe(true);
    expect(model.service?.health?.score).toBe('88%');
    expect(model.service?.health?.kpi.warnings).toBe(1);
  });

  it('should degrade an unknown service id to the overview, the node page rule', () => {
    // Given
    const document = federatedDocument();

    // When
    const model = buildPageModel(document, {
      page: 'service',
      serviceId: 'nobody',
      markdown,
    });

    // Then
    expect(model.kind).toBe('overview');
    expect(model.service).toBeNull();
  });

  it('should carry the service id on the navigation group and on no other entry', () => {
    // Given
    const document = federatedDocument();

    // When
    const navigation = buildNavigation(document);

    // Then
    expect(navigation[0]?.serviceId).toBe('billing');
    expect(navigation[0]?.children.every((child) => child.serviceId === null)).toBe(true);
  });
});

describe('the service page markup', () => {
  it('should render the card with the empty status mark the live snapshot fills', async () => {
    // Given
    const document = federatedDocument();

    // When
    const page = await renderPage(document, { page: 'service', serviceId: 'billing' });

    // Then: the card, its facts, and the mark that is data-addressed and empty as served,
    // because a status baked into a cached page would lie exactly when it matters
    expect(page.appHtml).toContain('oref-service-page');
    expect(page.appHtml).toContain('data-oref-service="billing"');
    expect(page.appHtml).not.toContain('data-oref-remote-status');
    expect(page.appHtml).toContain('/billing');
    expect(page.appHtml).toContain('oref-section-health');
    // And the rail's service group links the card through its status dot
    expect(page.appHtml).toContain('oref-nav-service');
    expect(page.appHtml).toContain('href="/service/billing"');
  });

  it('should redact the service report in transit and keep the flag, the health page rule', () => {
    // Given
    const document = federatedDocument();
    const model = buildPageModel(document, {
      page: 'service',
      serviceId: 'billing',
      markdown,
    });
    expect(model.service?.health).not.toBeNull();

    // When
    const state = JSON.parse(serializePageModel(model)) as {
      service: { health: unknown; healthRendered: boolean; id: string } | null;
    };

    // Then
    expect(state.service?.health).toBeNull();
    expect(state.service?.healthRendered).toBe(true);
    expect(state.service?.id).toBe('billing');
  });
});
