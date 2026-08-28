/**
 * `@openref/core/security`: the address, path and scheme rules, on their own entry point.
 *
 * WHY A SECOND ENTRY POINT RATHER THAN THE BARREL, AND IT IS THE `@openref/vue/runner` reason one
 * package over. These four modules are read by the same origin proxy, the static generator, the
 * CLI and the rewriting transport, and by nothing the first paint of a page does. Re-exported from
 * the main barrel they were pulled into the chunk the entry already loads for the error classes,
 * measured at 491 bytes of a budget that had 205 to give, which is a first paint paying for a
 * guard no reader on it will ever run.
 *
 * The rule the split follows is the one T031 recorded: what pins a module into the first paint is
 * a barrel the first paint imports statically re-exporting it, not the package it lives in.
 */

export { addressRefusal, isAddressLiteral, parseIpv4, parseIpv6 } from './security/domain/address';
export type { AddressRefusal } from './security/domain/address';
export { refusesPathSuffix } from './security/domain/path-suffix';
export {
  DOCUMENT_LINK_SCHEMES,
  HTTP_SCHEMES,
  isHttpUrl,
  isSecureCredentialUrl,
  LOOPBACK_HOSTS,
} from './security/domain/schemes';
export type { HttpScheme } from './security/domain/schemes';
