/**
 * The registry that compiles everything up front, which is what a server render needs.
 *
 * THIS MODULE IS THE ONE THE CLIENT BUNDLE MUST NOT REACH. It is the only place the deferrable
 * components are imported statically, so anything importing it pulls all of them into whatever
 * chunk it lands in. `browser/index.ts` therefore imports the deferred registry instead, and
 * `client-bundle.spec.ts` reads the built file for the marker that proves it.
 *
 * THE SERVER RESOLVED POSITIONS OF SPEC 10.4 ARE RESOLVED HERE AND NOWHERE ELSE, per `TX-ADOPT`
 * and the Health panel's precedent: what fills the same positions in the browser is an element
 * that adopts the markup it was handed. Resolving a slot on both sides would have the client
 * draw a theme's component over markup it is supposed to leave alone; resolving it only here
 * means whatever the theme draws is what the reader receives. The wrappers forward exactly the
 * contract props, so a prop the composition adds for its own bookkeeping never reaches a theme.
 */

import { useSlot } from '@openref/vue';
import { h, type Component, type VNode } from 'vue';
import { ChannelFacts, ChannelOperations, MessageList } from './ChannelSections';
import { CommandPalette } from './CommandPalette';
import { DocumentOverview } from './DocumentOverview';
import { HealthPanel } from './HealthPanel';
import { NodeDescription, NodeSecurity } from './NodeSections';
import { OperationHeader } from './OperationHeader';
import { ParamTable } from './ParamTable';
import { ResponseList } from './ResponseList';
import { RuntimePanel } from './RuntimePanel';
import { SchemaView } from './SchemaView';
import { ServiceCard } from './ServiceCard';
import { ShapesFillPanel } from './ShapesFillPanel';
import { ShapesReader } from './ShapesReader';
import { SocketConsole } from './SocketConsole';
import { StatesPanel } from './StatesPanel';
import { TryItPanel } from './TryItPanel';
import type { DeferrableComponents } from './deferrable';
import type {
  DriftModel,
  ErrorContractGroupModel,
  HealthModel,
  IRTopology,
  NodeHeaderModel,
  ParameterModel,
  ResponseMarkModel,
  ResponseModel,
  RuntimeModel,
  SchemaPayloadMap,
} from '@openref/vue';

/** Draws the Health panel the theme put in the position, or the one this package ships. */
const HealthScore: Component = (props: { readonly health: HealthModel }): VNode =>
  h(useSlot('HealthScore', HealthPanel).value, { health: props.health });

/** The operation header the theme put in the position, or the reference's. */
const HeaderPosition: Component = (props: {
  readonly node: NodeHeaderModel;
  readonly drift: readonly DriftModel[];
  readonly benchHref: string;
}): VNode =>
  h(useSlot('OperationHeader', OperationHeader).value, {
    node: props.node,
    drift: props.drift,
    benchHref: props.benchHref,
  });

/** The runtime panel the theme put in the position, or the reference's. */
const RuntimePosition: Component = (props: {
  readonly nodeId: string;
  readonly runtime: RuntimeModel;
}): VNode =>
  h(useSlot('RuntimePanel', RuntimePanel).value, { nodeId: props.nodeId, runtime: props.runtime });

/** The parameters table the theme put in the position, or the reference's. */
const ParamsPosition: Component = (props: { readonly parameters: readonly ParameterModel[] }) =>
  h(useSlot('ParamTable', ParamTable).value, { parameters: props.parameters });

/** The responses section the theme put in the position, or the reference's. */
const ResponsesPosition: Component = (props: {
  readonly responses: readonly ResponseModel[];
  readonly schemas: SchemaPayloadMap;
  readonly truncated: readonly string[];
  readonly basePath: string;
  readonly marks: readonly ResponseMarkModel[];
  readonly contracts: readonly ErrorContractGroupModel[];
}): VNode =>
  h(useSlot('ResponseList', ResponseList).value, {
    responses: props.responses,
    schemas: props.schemas,
    truncated: props.truncated,
    basePath: props.basePath,
    marks: props.marks,
    contracts: props.contracts,
  });

/**
 * The overview article the theme put in the position, or the reference's.
 *
 * EVERY PROP IS FORWARDED BY NAME, AND THAT IS A HAZARD AS WELL AS A CONTRACT. Naming them is what
 * makes the position's surface exactly the four the contract promises, so a theme override cannot
 * come to depend on something the reference happens to pass. It also means a prop added upstream
 * and not added here is dropped in silence: `T052` added `topology` to the page model and to both
 * overviews, and until this list grew, every one of them drew nothing and every test that did not
 * render through a theme stayed green.
 *
 * TWO SUITES CATCH THE DROP AND THEY ARE BOTH INTEGRATION, WHICH IS MEASURED RATHER THAN ASSUMED.
 * Deleting `topology` from the forward below leaves every unit test in the repository green,
 * including `packages/render/test/unit/topology-section.spec.ts`, which mounts `DocumentOverview`
 * itself and therefore never travels through this position. What turns red is
 * `packages/render/test/integration/element.spec.ts`, two cases, and the second reference theme's
 * own topology suite, four; that theme is not named here because no source file outside it may
 * name it, and the file above carries both paths in full. A prop added here in future is only
 * guarded once one of those two renders through the position and asserts it.
 */
const OverviewPosition: Component = (props: {
  readonly title: string;
  readonly descriptionHtml: string;
  readonly servers: readonly string[];
  readonly basePath: string;
  readonly topology: IRTopology | null;
}): VNode =>
  h(useSlot('DocumentOverview', DocumentOverview).value, {
    title: props.title,
    descriptionHtml: props.descriptionHtml,
    servers: props.servers,
    basePath: props.basePath,
    topology: props.topology,
  });

/** Every deferrable component, resolved at import time. */
export const EAGER_COMPONENTS: DeferrableComponents = {
  schemaView: SchemaView,
  tryIt: TryItPanel,
  commandPalette: CommandPalette,
  healthPanel: HealthScore,
  shapesReader: ShapesReader,
  shapesFill: ShapesFillPanel,
  operationHeader: HeaderPosition,
  runtimePanel: RuntimePosition,
  nodeDescription: NodeDescription as Component,
  nodeSecurity: NodeSecurity as Component,
  paramTable: ParamsPosition,
  channelFacts: ChannelFacts as Component,
  channelOperations: ChannelOperations as Component,
  messageList: MessageList as Component,
  socketConsole: SocketConsole,
  responseList: ResponsesPosition,
  overviewPage: OverviewPosition,
  statesPage: StatesPanel,
  servicePage: ServiceCard as Component,
};
