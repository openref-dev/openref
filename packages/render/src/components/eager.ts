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
import { StatesPanel } from './StatesPanel';
import { TryItPanel } from './TryItPanel';
import type { DeferrableComponents } from './deferrable';
import type {
  DriftModel,
  ErrorContractGroupModel,
  HealthModel,
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

/** The overview article the theme put in the position, or the reference's. */
const OverviewPosition: Component = (props: {
  readonly title: string;
  readonly descriptionHtml: string;
  readonly servers: readonly string[];
  readonly basePath: string;
}): VNode =>
  h(useSlot('DocumentOverview', DocumentOverview).value, {
    title: props.title,
    descriptionHtml: props.descriptionHtml,
    servers: props.servers,
    basePath: props.basePath,
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
  responseList: ResponsesPosition,
  overviewPage: OverviewPosition,
  statesPage: StatesPanel,
  servicePage: ServiceCard as Component,
};
