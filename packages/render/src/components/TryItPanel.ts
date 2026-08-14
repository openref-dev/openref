/**
 * The try-it console: fill a field, send, read the response.
 *
 * IT IS THE HOST OF SIX POSITIONS AND DRAWS ALMOST NOTHING ITSELF, since `TX-SLOTWIRE`.
 * `ServerSelect`, `AuthPanel`, `ShapeForm`, `SendButton`, `ResponseView` and `StreamLog` are
 * slots; what stays here is the state they read and the runner they act through, because that is
 * what a theme must not have to reimplement to change a control.
 *
 * THREE THINGS ABOUT THE SERVER RENDER, and all three are the same decision seen from different
 * sides.
 *
 * A CREDENTIAL NEVER REACHES THE MARKUP. The fields are empty in the server render and in the
 * first client render, and stored values are read in `onMounted`, which runs after hydration
 * has matched. So a page cached by document hash, per SPEC 12, is a page that could not carry
 * one even if the cache were shared between readers.
 *
 * NOTHING STRUCTURAL DEPENDS ON WHETHER A RUNNER EXISTS. The server has none and the browser
 * usually does, and a panel that rendered a different shape in each would be a hydration
 * mismatch on every operation page. The form is the same either way; only whether the send
 * button is enabled changes, and it changes after mount.
 *
 * THE CLICK HANDLER READS THE REFS RATHER THAN THE RENDER IT WAS CREATED IN, and that is load
 * bearing rather than style. The replay dispatches the reader's click from `onMounted`, before
 * the re-render that `mounted.value = true` schedules has flushed, so the listener on the
 * element is still the one this render created. A guard closing over the values of that render
 * would read the state of a console that had not mounted yet and swallow the click it exists
 * to deliver.
 */

import { useSlot } from '@openref/vue';
import { computed, defineComponent, h, onMounted, ref, type PropType, type VNode } from 'vue';
import { AuthPanel, isOAuthScheme } from './AuthPanel';
import { ResponseView } from './ResponseView';
import { SendButton } from './SendButton';
import { ServerSelect } from './ServerSelect';
import { ShapeForm, BINARY_FIELD } from './ShapeForm';
import { StateNotice } from './StateNotice';
import { StreamLog } from './StreamLog';
import { field, fieldId } from './field';
import { createStreamLog } from '../console/domain/stream-log';
import { useRunnerFor } from '@openref/vue/runner';
import {
  useRunnerPort,
  type RunnerBody,
  type RunnerBodyField,
  type RunnerBodyMediaTypeView,
  type RunnerFile,
  type RunnerOAuthClient,
  type RunnerOAuthFlowKind,
  type RunnerOAuthFlowView,
  type RunnerOperationView,
  type RunnerParameterView,
  type RunnerSecuritySchemeView,
  type RunnerStreamElement,
  type RunnerStreamEnd,
  type RunnerStreamHandle,
  type RunnerValue,
} from '@openref/vue';
import { eventValue, type KeyEvent, type ValueEvent } from '../shared/dom';
import { navigateTo, readSignInNotice, redirectTargets } from '../shared/oauth-console';

/** Rows of a field holding a list, which is short because most lists are. */
const LIST_ROWS = 3;

/** Key a typed value is held under, matching what the runner reads. */
function valueKey(location: string, name: string): string {
  return `${location}:${name}`;
}

/**
 * From the text in a field to the value the matrix of SPEC 14.2 renders.
 *
 * THE CONSOLE HOLDS TEXT AND THE PORT TAKES A KIND, and this is the one place the two meet. A
 * field is a text control whatever the parameter declares, so the state here is one string per
 * field; which cell of the matrix that string lands in is the document's answer, carried on
 * `valueKind`, and never a guess made from the shape of what was typed.
 *
 * ONE MEMBER PER LINE, AND A LINE FEED IS THE ONE SEPARATOR A VALUE CANNOT CONTAIN. A comma
 * separated field cannot express a member with a comma in it, and a query parameter whose values
 * are sentences is ordinary. The note under the field says which format it is asking for.
 *
 * AN EMPTY FIELD IS AN EMPTY LIST AND NOT A LIST OF ONE EMPTY MEMBER. Splitting `''` on a line
 * feed yields `['']`, which would send `color=` where the reader asked for nothing at all.
 *
 * @param parameter - The parameter, for the kind its schema declares
 * @param text - What the reader typed
 * @returns The typed value
 */
function typedValue(parameter: RunnerParameterView, text: string): RunnerValue {
  if (parameter.valueKind === 'primitive') return { kind: 'primitive', value: text };

  const lines = text === '' ? [] : text.split('\n');
  if (parameter.valueKind === 'array') return { kind: 'array', value: lines };

  return {
    kind: 'object',
    value: lines.map((line) => {
      // SPLIT AT THE FIRST `=` AND NOT AT EVERY ONE, because a value is allowed to contain one
      // and a field name is not the place to forbid it. A line with no `=` is a field with an
      // empty value rather than a line thrown away: the reader typed it and meant something.
      const at = line.indexOf('=');
      return at === -1 ? ([line, ''] as const) : ([line.slice(0, at), line.slice(at + 1)] as const);
    }),
  };
}

/** What the field asks for, after the location and whether it is required. */
function formatNote(parameter: RunnerParameterView): string {
  const base = parameter.required ? `${parameter.in}, required` : parameter.in;

  if (parameter.valueKind === 'array') return `${base}, one value per line`;
  if (parameter.valueKind === 'object') return `${base}, one key=value per line`;

  return base;
}

/** Renders the console for one operation. */
export const TryItPanel = defineComponent({
  name: 'OrefTryItPanel',

  props: {
    run: { type: Object as PropType<RunnerOperationView | null>, default: null },
    /** Where the reference is mounted, so the OAuth2 callback route can be named. */
    basePath: { type: String, default: '' },
    /**
     * Status codes the document declares, for the response verdict chip of `TX-MARKUP`.
     *
     * A prop rather than a derivation because `run` is the runner's projection and carries
     * what a request needs, not what the document promises about the answer.
     */
    declared: { type: Array as PropType<readonly string[]>, default: () => [] },
    /**
     * Parameters the scan saw the application not read, keyed `location:name`, per SPEC 11's
     * F14 boundary and `TX-PARITY-UI`: the field is disabled with the reason in its
     * placeholder, because the fact is about the parameter and not about a missing
     * capability. Only `not-seen-read` rows arrive here; `unaccounted` is the scan speaking
     * about itself and disables nothing.
     */
    unread: { type: Array as PropType<readonly string[]>, default: () => [] },
  },

  setup(props) {
    // THE OAUTH2 HALF GOES THROUGH THE COMPOSABLE SINCE T031, AND IT USED TO GO ROUND IT. The
    // console reached `IRunnerPort` directly for the whole of SPEC 14.4 because everything
    // `useRunnerFor` retained sat in the first paint chunk of every page. That was the barrel
    // rather than the package: these two functions now arrive through `@openref/vue/runner`,
    // which no page imports until somebody presses Send, so a theme writing its own console gets
    // the same surface the shipped one uses instead of a component it does not own.
    const runner = useRunnerFor(() => props.run ?? undefined);
    // THE STREAM STILL GOES THROUGH THE PORT, AND THAT IS THE REMAINING HALF RATHER THAN AN
    // OVERSIGHT. T031's amendment is about the sign in surface; `IRunnerPort.stream` is a second
    // optional half of the port, per SPEC 14.6, and moving it into the composable is a contract
    // addition nobody has asked for yet. A theme that overrides `StreamLog` is handed the
    // elements, the counts and the two callbacks, so it does not reach for this either.
    const port = useRunnerPort();

    const serverSelect = useSlot('ServerSelect', ServerSelect);
    const authPanel = useSlot('AuthPanel', AuthPanel);
    const shapeForm = useSlot('ShapeForm', ShapeForm);
    const sendButton = useSlot('SendButton', SendButton);
    const responseView = useSlot('ResponseView', ResponseView);
    const streamLog = useSlot('StreamLog', StreamLog);
    const notice = useSlot('StateNotice', StateNotice);

    const values = ref<Record<string, string>>({});
    const credentials = ref<Record<string, string>>({});
    // WHAT THE READER TYPES INTO A SIGN IN FORM, KEYED BY SCHEME AND FIELD. It is not a credential
    // in the sense the store means: a client id is public, and a client secret or a password goes
    // to the token endpoint and is never written anywhere by this component. Like every other
    // field here, it is empty in the server render and in the first client render.
    const authInputs = ref<Record<string, string>>({});
    const flowChoice = ref<Record<string, string>>({});
    // WHAT IS LEFT HERE OF THE SIGN IN IS THE SENTENCES AND NOTHING ELSE. The sessions, the
    // devices, the discovered flows and which scheme is in flight are the composable's, so a
    // theme's own console has them without reimplementing the flow; a sentence to show beside a
    // scheme belongs to whoever draws the scheme.
    const authNotices = ref<Record<string, string>>({});
    // THE JSON BODY ARRIVES PREFILLED, per `TX-PARITY-UI` and SPEC 5.5's precedence, carried
    // on the projection as `exampleText`. The first text editor's example on both sides of
    // hydration, because the value is a pure function of the document; Reset returns here.
    const prefill = (): string =>
      (props.run?.body ?? []).find((media) => media.editor === 'text')?.exampleText ?? '';
    const bodyText = ref(prefill());
    // THE STREAM IS THREE PIECES OF STATE AND A HANDLE, and the window is the first of them.
    // `createStreamLog` in `console/domain` is what bounds it, per SPEC 14.6: a stream of ten
    // thousand elements leaves five hundred rows here and the counts of what went past.
    const streamElements = ref<readonly RunnerStreamElement[]>([]);
    const streamCounts = ref({ received: 0, invalid: 0, dropped: 0 });
    const streamEnd = ref<RunnerStreamEnd | null>(null);
    const streamOpen = ref(false);
    let streamHandle: RunnerStreamHandle | null = null;
    const chosenServer = ref('');
    const chosenMediaType = ref('');

    // ONE SET OF FIELD VALUES AND ONE SET OF FILES, KEYED BY FIELD NAME AND NOT BY MEDIA TYPE.
    // Switching between two declared media types keeps what the reader typed under the same
    // property name, which is what a document declaring both a JSON and a form flavour of one
    // endpoint means by declaring them: the same fields, encoded two ways.
    const fieldValues = ref<Record<string, string>>({});
    const files = ref<Record<string, RunnerFile>>({});

    // False during the server render and during the first client render, so both produce the
    // same markup, and true from the moment hydration has matched. Everything that could differ
    // between the two, a stored credential and whether a runner exists, waits behind it.
    const mounted = ref(false);

    const servers = computed(() => props.run?.servers ?? []);
    const serverUrl = computed(() =>
      chosenServer.value === '' ? (servers.value[0] ?? '') : chosenServer.value,
    );
    const bodies = computed<readonly RunnerBodyMediaTypeView[]>(() => props.run?.body ?? []);
    const mediaTypes = computed(() => bodies.value.map((media) => media.mediaType));
    const mediaType = computed(() =>
      chosenMediaType.value === '' ? (mediaTypes.value[0] ?? '') : chosenMediaType.value,
    );
    /** The declared body being filled in, which decides which of the three editors is drawn. */
    const bodyMedia = computed<RunnerBodyMediaTypeView | undefined>(() =>
      bodies.value.find((media) => media.mediaType === mediaType.value),
    );
    const schemes = computed(() => props.run?.security ?? []);
    const sendable = computed(
      () => mounted.value && runner.available.value && servers.value.length > 0,
    );

    /** Flows per scheme, as the panel is handed them. */
    const flows = computed<Record<string, readonly RunnerOAuthFlowView[]>>(() => {
      const map: Record<string, readonly RunnerOAuthFlowView[]> = {};
      for (const scheme of schemes.value) map[scheme.id] = runner.flows(scheme);
      return map;
    });

    function chosenFlow(scheme: RunnerSecuritySchemeView): RunnerOAuthFlowKind {
      const chosen = flowChoice.value[scheme.id];
      const offered = runner.flows(scheme);
      const known = offered.find((flow) => flow.kind === chosen);

      return known?.kind ?? offered[0]?.kind ?? 'authorizationCode';
    }

    onMounted(() => {
      mounted.value = true;

      const stored: Record<string, string> = {};
      for (const scheme of schemes.value) {
        const value = runner.credential(scheme.id);
        if (value !== undefined) stored[scheme.id] = value;
        if (isOAuthScheme(scheme)) runner.refreshSession(scheme.id);
      }
      credentials.value = stored;

      // WHAT HAPPENED ON THE WAY BACK FROM AN AUTHORIZATION SERVER IS SAID HERE. The exchange runs
      // on page load, before this console has been reached for, so its outcome waits in the same
      // place the flow's own record waited and is read the first time somebody opens the console.
      const landing = readSignInNotice();
      if (landing !== null) {
        // A LANDING THAT FAILED BEFORE IT COULD READ ITS OWN RECORD NAMES NO SCHEME, and the
        // sentence is shown against the first one that could have produced it rather than dropped.
        const known = schemes.value.some((scheme) => scheme.id === landing.schemeId);
        const fallback = schemes.value.find((scheme) => isOAuthScheme(scheme))?.id;
        const target = known ? landing.schemeId : fallback;

        if (target !== undefined) {
          authNotices.value = { ...authNotices.value, [target]: landing.message };
          runner.refreshSession(target);
        }
      }
    });

    function authInput(schemeId: string, name: string): string {
      return authInputs.value[`${schemeId}:${name}`] ?? '';
    }

    /**
     * What the reader typed into one scheme's sign in form, as the port takes it.
     *
     * THE SCOPES COME FROM THE FLOW AND NOT FROM A FIELD, which is why this needs the flow: a
     * reader is never asked to type a scope name, and a flow that declares none asks for none.
     */
    function clientFor(scheme: RunnerSecuritySchemeView): RunnerOAuthClient {
      const scopes = runner.flows(scheme).find((flow) => flow.kind === chosenFlow(scheme))?.scopes;

      return {
        clientId: authInput(scheme.id, 'clientId'),
        ...(authInput(scheme.id, 'clientSecret') === ''
          ? {}
          : { clientSecret: authInput(scheme.id, 'clientSecret') }),
        ...(authInput(scheme.id, 'username') === ''
          ? {}
          : { username: authInput(scheme.id, 'username') }),
        ...(authInput(scheme.id, 'password') === ''
          ? {}
          : { password: authInput(scheme.id, 'password') }),
        ...(scopes === undefined || scopes.length === 0 ? {} : { scopes }),
      };
    }

    /**
     * Runs the sign in and says what came of it.
     *
     * WHAT IS LEFT HERE AFTER T031 IS THE WINDOW AND THE SENTENCE. The flow choice, the discovery
     * request, the device wait and the session re-read are `useRunnerFor`'s, so a theme's own
     * console gets them; following a redirect is a decision about this window, and the sentence
     * shown beside a scheme belongs to whoever draws the scheme.
     */
    async function signIn(schemeId: string): Promise<void> {
      const scheme = schemes.value.find((candidate) => candidate.id === schemeId);
      if (scheme === undefined) return;

      authNotices.value = { ...authNotices.value, [scheme.id]: '' };

      // A DOCUMENT WITH NO LOCATION HAS NO REDIRECT URI, and the key is left off rather than set
      // to `undefined`, because the port reads its absence as "this flow cannot redirect".
      const redirect = redirectTargets(props.basePath);

      try {
        const outcome = await runner.signIn({
          scheme,
          flowKind: chosenFlow(scheme),
          client: clientFor(scheme),
          ...(redirect === undefined ? {} : { redirect }),
        });

        if (outcome.kind === 'redirect') {
          navigateTo(outcome.url);
          return;
        }

        authNotices.value = { ...authNotices.value, [scheme.id]: 'signed in' };
      } catch (cause) {
        authNotices.value = {
          ...authNotices.value,
          [scheme.id]: cause instanceof Error ? cause.message : 'the sign in failed',
        };
      }
    }

    function setValue(key: string, value: string): void {
      values.value = { ...values.value, [key]: value };
    }

    function setCredential(schemeId: string, value: string): void {
      credentials.value = { ...credentials.value, [schemeId]: value };
      runner.setCredential(schemeId, value);
    }

    /** Whether the console can act on a press right now, read at the moment of the press. */
    function canSend(): boolean {
      return sendable.value && !runner.pending.value;
    }

    /**
     * What the reader typed, as the kinds the matrix renders.
     *
     * A FIELD THE READER NEVER TOUCHED IS ABSENT AND A FIELD THEY CLEARED IS EMPTY, per SPEC
     * 14.2. `setValue` writes on every input event, so a field that was typed into and emptied
     * holds `''` and one that was never opened holds nothing at all, and the two now send
     * different requests: `?q=` and no `q`.
     */
    function typedValues(): Record<string, RunnerValue> {
      const typed: Record<string, RunnerValue> = {};

      for (const parameter of props.run?.parameters ?? []) {
        const key = valueKey(parameter.in, parameter.name);
        const text = values.value[key];
        if (text === undefined) continue;

        typed[key] = typedValue(parameter, text);
      }

      return typed;
    }

    /**
     * What the reader filled the body in with, in the form the editor they were shown produces.
     *
     * NOTHING IS SENT FOR AN EDITOR NOBODY TOUCHED. An untouched text editor holds an empty
     * string and an untouched form holds no field, and in both cases the request carries no body
     * at all rather than an empty one: an endpoint that takes an optional body must be reachable
     * without one, and the console is how a reader reaches it.
     */
    function bodyInput(): RunnerBody | undefined {
      const media = bodyMedia.value;
      if (media === undefined) return undefined;

      if (media.editor === 'binary') {
        const file = files.value[BINARY_FIELD];

        return file === undefined ? undefined : { kind: 'binary', file };
      }

      if (media.editor === 'text') {
        return bodyText.value.trim() === '' ? undefined : { kind: 'text', text: bodyText.value };
      }

      const parts: RunnerBodyField[] = [];

      for (const declared of media.fields) {
        if (declared.kind === 'file') {
          const file = files.value[declared.name];
          if (file !== undefined) parts.push({ kind: 'file', name: declared.name, file });
          continue;
        }

        // A FIELD THE READER NEVER TOUCHED IS ABSENT AND A FIELD THEY CLEARED IS EMPTY, which is
        // the same rule the parameters follow, one layer over: `name=` and no `name` are two
        // different form submissions, and a server validating a required field sees the
        // difference.
        const value = fieldValues.value[declared.name];
        if (value === undefined) continue;

        parts.push({
          kind: 'text',
          name: declared.name,
          value,
          ...(declared.contentType === undefined ? {} : { contentType: declared.contentType }),
        });
      }

      return parts.length === 0 ? undefined : { kind: 'fields', fields: parts };
    }

    async function send(): Promise<void> {
      try {
        const body = bodyInput();

        await runner.send({
          serverUrl: serverUrl.value,
          values: typedValues(),
          ...(body === undefined ? {} : { body }),
          ...(mediaType.value === '' ? {} : { mediaType: mediaType.value }),
        });
      } catch {
        // The message is already on `runner.error`, which is what the panel renders. Rethrowing
        // out of a click handler would reach nothing but the console of whoever opened one.
      }
    }

    /**
     * Opens the stream this operation declares and lets the window fill.
     *
     * NOTHING HERE HOLDS THE STREAM. The log holds the last window and the counts, this holds a
     * copy of the window for rendering, and neither grows with the stream. The handle is kept so
     * that Stop reaches the request rather than the reading, which is the decision SPEC 14.6
     * records and the difference between a stream that is over and a socket that is still open.
     */
    function startStream(): void {
      const at = port;
      const open = at?.stream?.bind(at);
      if (open === undefined || props.run === null) return;

      stopStream();
      const log = createStreamLog();
      streamElements.value = [];
      streamCounts.value = { received: 0, invalid: 0, dropped: 0 };
      streamEnd.value = null;
      streamOpen.value = true;

      const publish = (): void => {
        const state = log.state();
        streamElements.value = state.elements;
        streamCounts.value = {
          received: state.received,
          invalid: state.invalid,
          dropped: state.dropped,
        };
      };

      const body = bodyInput();
      streamHandle = open(
        {
          operation: props.run,
          serverUrl: serverUrl.value,
          values: typedValues(),
          ...(body === undefined ? {} : { body }),
          ...(mediaType.value === '' ? {} : { mediaType: mediaType.value }),
        },
        {
          onElement: (element) => {
            log.append(element);
            publish();
          },
          onEnd: (end) => {
            log.finish(end);
            publish();
            streamEnd.value = end;
            streamOpen.value = false;
            streamHandle = null;
          },
        },
      );
    }

    /** Stops the stream, which aborts the request rather than stopping the reading. */
    function stopStream(): void {
      streamHandle?.stop();
      streamHandle = null;
    }

    /**
     * Returns the form to its prefilled state, per `TX-PARITY-UI`: what the reader typed
     * goes, the example body returns, and the stored credentials stay, because signing in is
     * not form state and Reset is not Sign out.
     */
    function reset(): void {
      values.value = {};
      fieldValues.value = {};
      files.value = {};
      bodyText.value = prefill();
      chosenServer.value = '';
      chosenMediaType.value = '';
    }

    /** Sends on `Ctrl Enter` from anywhere in the console, which is what the hint promises. */
    function onConsoleKey(event: KeyEvent): void {
      if (event.key !== 'Enter' || (event.ctrlKey !== true && event.metaKey !== true)) return;

      event.preventDefault();
      if (!canSend()) return;

      void send();
    }

    function parameterFields(): VNode[] {
      const run = props.run;
      if (run === null) return [];

      const unread = new Set(props.unread);

      return run.parameters.map((parameter) => {
        const key = valueKey(parameter.in, parameter.name);
        const id = fieldId(parameter.in, parameter.name);
        // A LIST NEEDS A CONTROL THAT HOLDS A LINE FEED, so a parameter whose schema declares an
        // array or an object gets a textarea and a primitive keeps its single line input. This
        // is what makes the cells of SPEC 14.2 reachable from the page rather than only from the
        // port: a console that could only produce one line could only ever produce one column.
        const multiline = parameter.valueKind !== 'primitive';
        // A PARAMETER THE APPLICATION DOES NOT READ IS DISABLED WITH THE REASON, per SPEC 11's
        // F14 boundary: the capability is here, the fact is about the parameter, and the
        // placeholder speaks the scan's own words.
        const dead = unread.has(key);

        return field(
          parameter.name,
          id,
          h(multiline ? 'textarea' : 'input', {
            class: 'oref-field-control',
            id,
            ...(multiline ? { rows: LIST_ROWS, spellcheck: 'false' } : { type: 'text' }),
            value: values.value[key] ?? '',
            'aria-required': parameter.required ? 'true' : 'false',
            ...(dead ? { disabled: true, placeholder: 'not seen read by the handler' } : {}),
            onInput: (event: ValueEvent) => {
              setValue(key, eventValue(event));
            },
          }),
          formatNote(parameter),
        );
      });
    }

    function mediaTypeField(): VNode | null {
      if (props.run === null || mediaTypes.value.length < 2) return null;

      // ONLY WHEN THERE IS A CHOICE. One declared media type is not a choice, and a select with
      // one option asks a reader to make a decision that has already been made for them.
      const id = fieldId('body', 'media-type');

      return field(
        'Body media type',
        id,
        h(
          'select',
          {
            class: 'oref-field-control',
            id,
            value: mediaType.value,
            onChange: (event: ValueEvent) => {
              chosenMediaType.value = eventValue(event);
            },
          },
          mediaTypes.value.map((type) => h('option', { key: type, value: type }, type)),
        ),
        null,
      );
    }

    return (): VNode | null => {
      const run = props.run;
      if (run === null) return null;

      const body: (VNode | VNode[] | null)[] = [h('h2', { class: 'oref-section-title' }, 'Try it')];

      if (servers.value.length === 0) {
        body.push(
          h(notice.value, {
            kind: 'no-server',
            message: 'This document declares no server, so there is nowhere to send a request.',
          }),
        );

        return h('section', { class: 'oref-section oref-section-tryit' }, body);
      }

      const media = bodyMedia.value;

      body.push(
        h('div', { class: 'oref-tryit-form' }, [
          h(serverSelect.value, {
            servers: servers.value,
            activeServerUrl: serverUrl.value,
            onSelect: (url: string): void => {
              chosenServer.value = url;
            },
          }),
          h(authPanel.value, {
            schemes: schemes.value,
            credentials: credentials.value,
            inputs: authInputs.value,
            flows: flows.value,
            chosenFlow: flowChoice.value,
            sessions: runner.sessions.value,
            notices: authNotices.value,
            devices: runner.devices.value,
            pending: runner.signingIn.value ?? null,
            mounted: mounted.value,
            onCredential: setCredential,
            onInput: (schemeId: string, name: string, value: string): void => {
              authInputs.value = { ...authInputs.value, [`${schemeId}:${name}`]: value };
            },
            onFlow: (schemeId: string, kind: string): void => {
              flowChoice.value = { ...flowChoice.value, [schemeId]: kind };
            },
            onSignIn: (schemeId: string): void => {
              void signIn(schemeId);
            },
            onSignOut: (schemeId: string): void => {
              runner.signOut(schemeId);
            },
          }),
          ...parameterFields(),
          mediaTypeField(),
          media === undefined
            ? null
            : h(shapeForm.value, {
                media,
                values: fieldValues.value,
                files: files.value,
                text: bodyText.value,
                onField: (name: string, value: string): void => {
                  fieldValues.value = { ...fieldValues.value, [name]: value };
                },
                onFile: (name: string, file: RunnerFile | undefined): void => {
                  if (file === undefined) {
                    const { [name]: _dropped, ...rest } = files.value;
                    files.value = rest;
                    return;
                  }
                  files.value = { ...files.value, [name]: file };
                },
                onText: (text: string): void => {
                  bodyText.value = text;
                },
              }),
        ]),
        // THE ROW IS THE BENCH'S OWN AND NOT THE SLOT'S: the send position already lays out
        // its button and notice in the actions row it draws, and Reset and the chord hint
        // stand beside that whole position, not inside it.
        h('div', { class: 'oref-bench-actions' }, [
          h(sendButton.value, {
            available: sendable.value,
            pending: runner.pending.value,
            mounted: mounted.value,
            // Two different states, and neither of them is a promise about a moment the reader
            // will not see. Before mount the notice names the action that brings the console, per
            // SPEC 11: the shell is interactive within a moment of the load, so "once the page is
            // interactive" was a sentence that stopped being true immediately and never changed,
            // because what changes it is this component mounting, and this component mounts only
            // when somebody reaches for it. A reader who never reached read a permanent excuse
            // beside a control marked unavailable, and read the product as broken. After mount the
            // console is disabled because this build carries no runner, which is a property of how
            // the reference was published and not of anything the reader can set.
            notice: sendable.value
              ? ''
              : mounted.value
                ? 'This build carries no request runner, so the console is read only. The application hosting this reference composes one in.'
                : 'The console loads when you press Send.',
            onSend: (): void => {
              if (!canSend()) return;

              void send();
            },
          }),
          // RESET AND THE HINT ARE THE CONSOLE'S AND NOT THE SLOT'S, per `TX-PARITY-UI`: the
          // slot is the send control, and a theme that overrides it keeps both. The kbd chip
          // is static text a screen reader may read, because no `aria-keyshortcuts` carries
          // the chord here; the handler on the section is what makes the words true.
          h('button', { class: 'oref-tryit-reset', type: 'button', onClick: reset }, 'Reset'),
          h('span', { class: 'oref-kbd' }, 'Ctrl Enter'),
        ]),
        h(responseView.value, {
          result: runner.result.value,
          error: runner.error.value,
          pending: runner.pending.value,
          declared: props.declared,
        }),
        run.stream === undefined
          ? null
          : h(streamLog.value, {
              elements: streamElements.value,
              counts: streamCounts.value,
              end: streamEnd.value,
              open: streamOpen.value,
              mounted: mounted.value,
              available: sendable.value,
              onStart: startStream,
              onStop: stopStream,
            }),
      );

      return h(
        'section',
        { class: 'oref-section oref-section-tryit', onKeydown: onConsoleKey },
        body,
      );
    };
  },
});
