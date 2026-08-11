/**
 * Injection tokens, which are strings rather than symbols on purpose.
 *
 * A symbol is unique per module instance, and this package is bundled into `@openref/nest` while
 * a host may also have a copy resolved through a different path in a monorepo. Two symbols named
 * the same are two tokens, and the failure presents as a provider NestJS cannot resolve with no
 * indication that there are two copies. A namespaced string collides only with itself.
 */

/** The bootstrap provider `forRoot` registers, which holds the mounted references. */
export const OPENREF_REFERENCES = 'OPENREF_REFERENCES';
