import { defineTheme } from '@openref/vue';
import AuthPanel from './components/AuthPanel';
import CodeSample from './components/CodeSample';
import CommandPalette from './components/CommandPalette';
import DocumentOverview from './components/DocumentOverview';
import DriftCard from './components/DriftCard';
import HealthScore from './components/HealthScore';
import NavTree from './components/NavTree';
import OperationHeader from './components/OperationHeader';
import ParamTable from './components/ParamTable';
import ProvenanceTag from './components/ProvenanceTag';
import ResponseList from './components/ResponseList';
import ResponseView from './components/ResponseView';
import RuntimePanel from './components/RuntimePanel';
import SchemaPage from './components/SchemaPage';
import SchemaTree from './components/SchemaTree';
import SendButton from './components/SendButton';
import ServerSelect from './components/ServerSelect';
import ShapeForm from './components/ShapeForm';
import StateNotice from './components/StateNotice';
import StreamLog from './components/StreamLog';
import type { ThemeDefinition } from '@openref/vue';

/**
 * telltale, a level 2 theme, per SPEC 10.1 and `ai-docs/design/telltale`.
 *
 * An instrument rather than a document: everything is monospace, every row sits on a 21 px grid,
 * provenance is a three letter code that survives a monochrome print, and the frame carries a
 * bench line at the bottom saying what the page weighs.
 *
 * IT IS WRITTEN AGAINST THE PUBLISHED CONTRACT AND NOTHING ELSE. The only OPENREF package this
 * one imports is `@openref/vue`: the slot names, the props each position is handed, and
 * `defineTheme` itself. It never imports `@openref/render`, which is what makes this package the
 * proof T032 was scheduled for rather than a second copy of the reference with other colours.
 *
 * THE SHELL IS `layout` AND NOT `components.AppShell`, which are one position by two names.
 * `resolveTheme` refuses a theme that writes both.
 *
 * NO TOKEN DEFAULTS ARE DECLARED HERE AND THAT IS DELIBERATE. `tokens` on a theme definition is
 * the L0 surface, for a theme that adjusts a handful of values and leaves the rest to whatever is
 * already on the page. This theme ships all 122 in a stylesheet of its own, in both colour modes,
 * because an L2 theme that declared them here would declare them once and lose the dark mode: a
 * record of strings has no cascade in it.
 */
const telltale: ThemeDefinition = defineTheme({
  name: 'telltale',
  layout: () => import('./Layout'),
  components: {
    NavTree,
    CommandPalette,
    DocumentOverview,
    SchemaPage,
    OperationHeader,
    RuntimePanel,
    ProvenanceTag,
    DriftCard,
    ParamTable,
    ResponseList,
    CodeSample,
    SchemaTree,
    ShapeForm,
    AuthPanel,
    ServerSelect,
    SendButton,
    ResponseView,
    StreamLog,
    HealthScore,
    StateNotice,
  },
  assets: {
    css: [
      '@openref/theme-telltale/fonts.css',
      '@openref/theme-telltale/tokens.css',
      '@openref/theme-telltale/theme.css',
    ],
  },
});

export default telltale;
