import { PACKAGE_NAME as CORE_PACKAGE } from '@openref/core';
import { PACKAGE_NAME as RENDER_PACKAGE } from '@openref/render';

/**
 * `@openref/agent`: the agent surface of SPEC 18.1, built at `T058`.
 *
 * It answers `<route>/llms.txt`, `<route>/llms-full.txt` and `<route>/mcp` for one mounted
 * document. It is internal and bundled into `@openref/nest`, per STANDARDS 3.2, because a host
 * configures it with two booleans and calls none of it directly.
 *
 * IT READS AND NEVER SENDS. Every answer is a projection of a document this process already holds:
 * no request leaves, no state is kept between calls, and nothing here can reach the API the
 * reference describes. Performing a request is the runner and the same origin proxy of SPEC 14.5,
 * which have an allowlist and an SSRF defence; a second one written here would be a second answer
 * to a question that already has one.
 */

/**
 * Name of this package.
 *
 * Exported so that the dependency graph linter has a real edge to follow and so that
 * diagnostics can report which package produced a value.
 */
export const PACKAGE_NAME = '@openref/agent';

/**
 * Packages this package is allowed to depend on, in the order declared by STANDARDS 3.5.
 *
 * THE EDGE TO `render` IS THE ADDRESS AND TITLE AUTHORITY AND NOT A CONVENIENCE. `links.ts`
 * decides where a page lives and `materializeNode` decides what a node is called; an agent file
 * that spelled either itself would be a broken link or a second title for one operation, which is
 * the defect those two functions were centralised to prevent.
 */
export const UPSTREAM_PACKAGES: readonly string[] = [CORE_PACKAGE, RENDER_PACKAGE];

export {
  AgentSurfaceService,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
} from './mcp/application/services/agent-surface.service';
export type {
  AgentSurfaceOptions,
  AgentSurfaceReply,
} from './mcp/application/services/agent-surface.service';

export {
  DEFAULT_AGENT_LLMS_TXT,
  DEFAULT_AGENT_MCP,
  resolveAgentOptions,
} from './mcp/domain/agent-options';
export type { AgentOptions, ResolvedAgentOptions } from './mcp/domain/agent-options';

export {
  agentExposure,
  AUDIENCE_EXTENSION,
  INTERNAL_AUDIENCE,
  isInternalAudience,
  isMutatingMethod,
  SAFE_HTTP_METHODS,
} from './mcp/domain/exposure';
export type { AgentExposure } from './mcp/domain/exposure';

export { agentTools, toolCallText, toolNameOf } from './mcp/domain/tools';
export type { AgentTool } from './mcp/domain/tools';

export {
  agentHealthReport,
  agentResources,
  HEALTH_RESOURCE_URI,
  LLMS_FULL_RESOURCE_URI,
  LLMS_RESOURCE_URI,
  readAgentResource,
} from './mcp/domain/resources';
export type {
  AgentHealthReport,
  AgentResource,
  AgentResourceContents,
  AgentResourceRead,
} from './mcp/domain/resources';

export {
  JSONRPC_ERROR,
  JSONRPC_VERSION,
  jsonRpcError,
  jsonRpcResult,
  readJsonRpc,
} from './mcp/domain/jsonrpc';
export type { JsonRpcId, JsonRpcRead, JsonRpcRequest, JsonRpcResponse } from './mcp/domain/jsonrpc';

export {
  buildLlmsFull,
  buildLlmsIndex,
  LLMS_FULL_SEGMENT,
  LLMS_SEGMENT,
  MCP_SEGMENT,
} from './llms/domain/llms-text';
export type { LlmsTextOptions } from './llms/domain/llms-text';
export { oneLine, plainSummary, SUMMARY_LIMIT } from './llms/domain/summary';
