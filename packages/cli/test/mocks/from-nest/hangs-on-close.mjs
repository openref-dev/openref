export async function createApp() {
  const document = {
    id: 'fixture',
    kind: 'openapi',
    hash: 'h',
    info: { title: 'Hangy', version: '1.0.0' },
    servers: [],
    navigation: [],
    nodes: new Map(),
    schemas: new Map(),
    security: [],
    relationships: [],
    webhooks: new Map(),
  };

  return {
    get: () => ({ all: () => [{ pass: { document } }] }),
    // Never settles, on purpose: this is the fixture that proves the force close timeout.
    close: () => new Promise(() => {}),
  };
}
