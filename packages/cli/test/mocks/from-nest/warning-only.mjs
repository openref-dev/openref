function operation() {
  return {
    kind: 'operation',
    id: 'get-widgets',
    method: 'get',
    path: '/widgets',
    rawOperationId: 'getWidgets',
    tags: [],
    deprecated: false,
    parameters: [],
    responses: [{ statusCode: '200', description: 'ok', content: [] }],
    security: [],
    servers: [],
  };
}

export async function createApp() {
  const document = {
    id: 'warning-only',
    kind: 'openapi',
    hash: 'h',
    info: { title: 'WarningOnly', version: '1.0.0' },
    servers: [],
    navigation: [],
    nodes: new Map([['get-widgets', operation()]]),
    schemas: new Map(),
    security: [],
    relationships: [],
    webhooks: new Map(),
  };

  return {
    get(token) {
      if (token !== 'OPENREF_REFERENCES') return undefined;
      return { all: () => [{ pass: { document } }] };
    },
    close: () => Promise.resolve(),
  };
}
