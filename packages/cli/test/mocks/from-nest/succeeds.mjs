function fixtureDocument(title) {
  return {
    id: 'fixture',
    kind: 'openapi',
    hash: 'h',
    info: { title, version: '1.0.0' },
    servers: [],
    navigation: [],
    nodes: new Map(),
    schemas: new Map(),
    security: [],
    relationships: [],
    webhooks: new Map(),
  };
}

export async function createApp() {
  const document = fixtureDocument('Fixture');

  return {
    get(token) {
      if (token !== 'OPENREF_REFERENCES') return undefined;
      return { all: () => [{ pass: { document } }] };
    },
    close: () => Promise.resolve(),
  };
}
