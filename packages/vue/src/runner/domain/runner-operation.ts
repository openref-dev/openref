/**
 * From an IR operation to the description a runner can send.
 *
 * ONE DERIVATION, TWO CONSUMERS. A theme reaches it through `useRunner`, which has the whole
 * document in state; the renderer calls it while building a page model, so the console works on
 * a page that carries no IR. Two derivations would be two answers to "which server does this
 * operation use", and the second would be found by a reader whose request went somewhere else.
 */

import type { IRDocument, IROperation } from '@openref/core';
import type {
  RunnerOperationView,
  RunnerParameterView,
  RunnerSecuritySchemeView,
} from '../application/ports/runner.port';

function parameterView(parameter: IROperation['parameters'][number]): RunnerParameterView {
  return {
    name: parameter.name,
    in: parameter.in,
    required: parameter.required,
    style: parameter.style,
    explode: parameter.explode,
    ...(parameter.allowReserved === undefined ? {} : { allowReserved: parameter.allowReserved }),
  };
}

function securityViews(
  operation: IROperation,
  document: IRDocument,
): readonly RunnerSecuritySchemeView[] {
  const schemes = new Map(document.security.map((scheme) => [scheme.id, scheme]));
  const views: RunnerSecuritySchemeView[] = [];
  const seen = new Set<string>();

  for (const requirement of operation.security) {
    if (seen.has(requirement.schemeId)) continue;
    seen.add(requirement.schemeId);

    const scheme = schemes.get(requirement.schemeId);
    // A requirement naming a scheme the document never declared is dropped rather than carried
    // as a nameless credential field. The drift rules of SPEC 7.1 are what report it; a console
    // that showed a field for it would be asking the reader to fill in a scheme nobody defined.
    if (scheme === undefined) continue;

    views.push({
      id: scheme.id,
      type: scheme.type,
      ...(scheme.in === undefined ? {} : { in: scheme.in }),
      ...(scheme.name === undefined ? {} : { name: scheme.name }),
      ...(scheme.scheme === undefined ? {} : { scheme: scheme.scheme }),
    });
  }

  return views;
}

/**
 * Projects one operation into what a runner needs to send it.
 *
 * @param operation - The operation as the IR carries it
 * @param document - The document it belongs to, for servers and security schemes
 * @returns A plain JSON description of the request that can be built for it
 *
 * @example
 * const run = runnerOperationOf(operation, document);
 */
export function runnerOperationOf(
  operation: IROperation,
  document: IRDocument,
): RunnerOperationView {
  const overrides = operation.servers.map((server) => server.url);
  const servers = overrides.length > 0 ? overrides : document.servers.map((server) => server.url);

  return {
    nodeId: operation.id,
    method: operation.method,
    path: operation.path,
    parameters: operation.parameters.map(parameterView),
    servers,
    security: securityViews(operation, document),
    bodyMediaTypes: (operation.requestBody?.content ?? []).map((media) => media.mediaType),
  };
}
