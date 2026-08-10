/**
 * The try-it console, M0 scope: fill a field, send, read the response.
 *
 * SPEC 14.1 puts the full serialization matrix, the remaining auth schemes, the same origin
 * proxy and streaming in M2. What is here is the minimum that makes M0 a product rather than a
 * viewer, and every request it cannot build faithfully is refused by the runner with a message
 * naming the reason, which this panel shows instead of a response.
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
 * THE RESPONSE IS TEXT, NEVER MARKUP. Status, headers and body come from a third party server
 * and are rendered as text children, which Vue escapes. Nothing on this path touches
 * `innerHTML`, and `security.spec.ts` plants a script tag in a response body to prove it.
 */

import { computed, defineComponent, h, onMounted, ref, type PropType, type VNode } from 'vue';
import {
  useRunnerFor,
  type RunnerOperationView,
  type RunnerSecuritySchemeView,
} from '@openref/vue';
import { eventValue, type ValueEvent } from '../shared/dom';

/** Rows of the body editor, fixed so the control reserves the same height on both sides. */
const BODY_ROWS = 8;

/** Id of one field, so its label can name it and two operations never collide. */
function fieldId(nodeId: string, kind: string, name: string): string {
  return `oref-field-${nodeId}-${kind}-${name}`.replace(/[^A-Za-z0-9_-]/g, '-');
}

/** Key a typed value is held under, matching what the runner reads. */
function valueKey(location: string, name: string): string {
  return `${location}:${name}`;
}

/**
 * What a reader is asked for, per scheme.
 *
 * The label names the credential rather than the scheme id where the scheme says enough to do
 * so, because `bearerAuth` is the document's word for it and `Bearer token` is the reader's.
 */
function credentialLabel(scheme: RunnerSecuritySchemeView): string {
  if (scheme.type === 'http') return `${scheme.scheme ?? 'http'} token`;
  if (scheme.type === 'apiKey') return `${scheme.name ?? 'API key'} (${scheme.in ?? 'header'})`;

  return scheme.id;
}

/** Whether M0 can send a credential for this scheme at all, per SPEC 14.1. */
function isRunnableScheme(scheme: RunnerSecuritySchemeView): boolean {
  if (scheme.type === 'apiKey') return scheme.in === 'header' || scheme.in === 'query';

  return scheme.type === 'http' && (scheme.scheme ?? '').toLowerCase() === 'bearer';
}

function statusClass(status: number): string {
  const first = Math.floor(status / 100);

  return first >= 1 && first <= 5 ? `oref-status-${String(first)}xx` : 'oref-status-default';
}

function field(label: string, id: string, control: VNode, note: string | null): VNode {
  return h('div', { class: 'oref-field', key: id }, [
    h('label', { class: 'oref-field-label', for: id }, label),
    control,
    note === null ? null : h('span', { class: 'oref-field-note' }, note),
  ]);
}

/** Renders the console for one operation. */
export const TryItPanel = defineComponent({
  name: 'OrefTryItPanel',

  props: {
    run: { type: Object as PropType<RunnerOperationView | null>, default: null },
  },

  setup(props) {
    const runner = useRunnerFor(() => props.run ?? undefined);

    const values = ref<Record<string, string>>({});
    const credentials = ref<Record<string, string>>({});
    const bodyText = ref('');
    const chosenServer = ref('');
    const chosenMediaType = ref('');

    // False during the server render and during the first client render, so both produce the
    // same markup, and true from the moment hydration has matched. Everything that could differ
    // between the two, a stored credential and whether a runner exists, waits behind it.
    const mounted = ref(false);

    const servers = computed(() => props.run?.servers ?? []);
    const serverUrl = computed(() =>
      chosenServer.value === '' ? (servers.value[0] ?? '') : chosenServer.value,
    );
    const mediaTypes = computed(() => props.run?.bodyMediaTypes ?? []);
    const mediaType = computed(() =>
      chosenMediaType.value === '' ? (mediaTypes.value[0] ?? '') : chosenMediaType.value,
    );
    const schemes = computed(() => props.run?.security ?? []);
    const sendable = computed(
      () => mounted.value && runner.available.value && servers.value.length > 0,
    );

    onMounted(() => {
      mounted.value = true;

      const stored: Record<string, string> = {};
      for (const scheme of schemes.value) {
        const value = runner.credential(scheme.id);
        if (value !== undefined) stored[scheme.id] = value;
      }
      credentials.value = stored;
    });

    function setValue(key: string, value: string): void {
      values.value = { ...values.value, [key]: value };
    }

    function setCredential(schemeId: string, value: string): void {
      credentials.value = { ...credentials.value, [schemeId]: value };
      runner.setCredential(schemeId, value);
    }

    async function send(): Promise<void> {
      try {
        await runner.send({
          serverUrl: serverUrl.value,
          values: values.value,
          ...(bodyText.value.trim() === '' ? {} : { body: bodyText.value }),
          ...(mediaType.value === '' ? {} : { mediaType: mediaType.value }),
        });
      } catch {
        // The message is already on `runner.error`, which is what the panel renders. Rethrowing
        // out of a click handler would reach nothing but the console of whoever opened one.
      }
    }

    function serverField(): VNode | null {
      const run = props.run;
      if (run === null || servers.value.length === 0) return null;

      const id = fieldId(run.nodeId, 'server', 'url');
      const control =
        servers.value.length === 1
          ? h('input', {
              class: 'oref-field-control',
              id,
              type: 'text',
              readonly: true,
              value: serverUrl.value,
            })
          : h(
              'select',
              {
                class: 'oref-field-control',
                id,
                value: serverUrl.value,
                onChange: (event: ValueEvent) => {
                  chosenServer.value = eventValue(event);
                },
              },
              servers.value.map((url) => h('option', { key: url, value: url }, url)),
            );

      return field('Server', id, control, null);
    }

    function parameterFields(): VNode[] {
      const run = props.run;
      if (run === null) return [];

      return run.parameters.map((parameter) => {
        const key = valueKey(parameter.in, parameter.name);
        const id = fieldId(run.nodeId, parameter.in, parameter.name);

        return field(
          parameter.name,
          id,
          h('input', {
            class: 'oref-field-control',
            id,
            type: 'text',
            value: values.value[key] ?? '',
            'aria-required': parameter.required ? 'true' : 'false',
            onInput: (event: ValueEvent) => {
              setValue(key, eventValue(event));
            },
          }),
          parameter.required ? `${parameter.in}, required` : parameter.in,
        );
      });
    }

    function credentialFields(): VNode[] {
      return schemes.value.map((scheme) => {
        const id = fieldId(props.run?.nodeId ?? '', 'auth', scheme.id);
        const runnable = isRunnableScheme(scheme);

        return field(
          credentialLabel(scheme),
          id,
          h('input', {
            class: 'oref-field-control',
            id,
            // A credential is a password field: it keeps the value out of a screen share and
            // out of a browser's form value history, neither of which a text field does.
            type: 'password',
            autocomplete: 'off',
            disabled: !runnable,
            value: credentials.value[scheme.id] ?? '',
            onInput: (event: ValueEvent) => {
              setCredential(scheme.id, eventValue(event));
            },
          }),
          runnable ? null : `${scheme.type} arrives in M2`,
        );
      });
    }

    function bodyField(): VNode | null {
      const run = props.run;
      if (run === null || mediaTypes.value.length === 0) return null;

      const id = fieldId(run.nodeId, 'body', 'json');

      return field(
        'Request body',
        id,
        h('textarea', {
          class: 'oref-field-control oref-field-body',
          id,
          rows: BODY_ROWS,
          spellcheck: 'false',
          value: bodyText.value,
          onInput: (event: ValueEvent) => {
            bodyText.value = eventValue(event);
          },
        }),
        mediaType.value,
      );
    }

    function resultBlock(): VNode | null {
      const result = runner.result.value;
      if (result === undefined) return null;

      return h('div', { class: 'oref-run-result' }, [
        h('div', { class: 'oref-run-summary' }, [
          h(
            'span',
            { class: `oref-status ${statusClass(result.status)}` },
            `${String(result.status)} ${result.statusText}`.trim(),
          ),
          h('span', { class: 'oref-run-time' }, `${String(Math.round(result.durationMs))} ms`),
        ]),
        result.headers.length === 0
          ? null
          : h(
              'dl',
              { class: 'oref-run-headers' },
              result.headers.flatMap((header) => [
                h('dt', { class: 'oref-run-header-name', key: `n:${header.name}` }, header.name),
                h('dd', { class: 'oref-run-header-value', key: `v:${header.name}` }, header.value),
              ]),
            ),
        h('pre', { class: 'oref-run-body' }, [h('code', {}, result.body)]),
      ]);
    }

    return (): VNode | null => {
      const run = props.run;
      if (run === null) return null;

      const body: (VNode | null)[] = [h('h2', { class: 'oref-section-title' }, 'Try it')];

      if (servers.value.length === 0) {
        body.push(
          h(
            'p',
            { class: 'oref-tryit-notice' },
            'This document declares no server, so there is nowhere to send a request.',
          ),
        );

        return h('section', { class: 'oref-section oref-section-tryit' }, body);
      }

      body.push(
        h('div', { class: 'oref-tryit-form' }, [
          serverField(),
          ...credentialFields(),
          ...parameterFields(),
          bodyField(),
        ]),
        h('div', { class: 'oref-tryit-actions' }, [
          h(
            'button',
            {
              class: 'oref-send',
              type: 'button',
              disabled: !sendable.value || runner.pending.value,
              onClick: () => {
                void send();
              },
            },
            runner.pending.value ? 'Sending' : 'Send',
          ),
          sendable.value
            ? null
            : h(
                'span',
                { class: 'oref-tryit-notice' },
                // Two different states, and only one of them lasts. Before mount the page is
                // simply not interactive yet. After it, the console is disabled because this
                // build carries no runner, which is a property of how the reference was
                // published and not of anything the reader can set. The message says so: a
                // notice that read as an error or as a missing setting would send a reader
                // looking for a switch that does not exist.
                mounted.value
                  ? 'This build carries no request runner, so the console is read only. The application hosting this reference composes one in.'
                  : 'The console becomes active once the page is interactive.',
              ),
        ]),
      );

      const failure = runner.error.value;
      if (failure !== undefined) body.push(h('p', { class: 'oref-run-error' }, failure));

      body.push(resultBlock());

      return h('section', { class: 'oref-section oref-section-tryit' }, body);
    };
  },
});
