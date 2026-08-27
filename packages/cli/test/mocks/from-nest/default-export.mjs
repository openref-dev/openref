export default async function createApp() {
  const document = {
    id: 'fixture',
    kind: 'openapi',
    hash: 'h',
    info: { title: 'DefaultExport', version: '1.0.0' },
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
    close: () => Promise.resolve(),
  };
}
