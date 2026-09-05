/**
 * The current node: what a reference page is actually about.
 *
 * It renders the model and computes nothing. Markdown is already HTML, examples are
 * already highlighted, types are already labelled. That is what lets the same component
 * render on the server and hydrate in the browser without either `marked` or `shiki`
 * crossing into the client bundle.
 *
 * IT WALKS `NodeModel.drawn` AND HOLDS NO CONDITIONS OF ITS OWN, since `TX-ADOPT`. The model
 * builder computes which sections exist, once, and both sides of hydration walk that list:
 * the client's state block empties the fields the old conditions read, so a composition that
 * recomputed `parameters.length > 0` here would draw one tree on the server and another in
 * the browser, silently. The static sections resolve through the deferrable registry, which
 * the server fills with the components that draw them and the browser fills with childless
 * elements that adopt what the server drew, the Health panel's mechanism applied to the rest
 * of the page.
 *
 * WHAT STAYS LIVE IN THIS FILE, each with the question it fails from SPEC 12: the request
 * body section hosts the schema tree islands, and the call samples block holds the language
 * tab, which is client state with a handler.
 */

import { useSlot } from '@openref/vue';
import { defineComponent, Fragment, h, onBeforeUnmount, ref, type PropType, type VNode } from 'vue';
import { CodeSample } from './CodeSample';
import { mediaTypeBlock, type SchemaContext } from './MediaTypeBlock';
import { useDeferrable } from './deferrable';
import { benchHref } from '../page/domain/links';
import type { IRSchema } from '@openref/core';
import type { CodeSampleLanguageModel, NodeModel } from '@openref/vue';

/** The tab names of a list of languages, as a sentence names them. */
function labelsOf(languages: readonly CodeSampleLanguageModel[]): string {
  return languages.map((language) => language.label).join(', ');
}

/** What copying a sample needs from the block it was drawn into, described rather than imported. */
interface BlockLike {
  querySelector(selector: string): { readonly textContent: string | null } | null;
}

/**
 * What the control is called, in every state, because a control that renames itself is two.
 *
 * IT IS AN `aria-label` AND NOT THE BUTTON'S TEXT, since the control shows an icon. A button whose
 * only content is a drawing has no accessible name at all, so this is the whole of what a screen
 * reader is given for it, and it says what pressing will do rather than what pressing did.
 */
const COPY_NAME = 'Copy the sample';

/**
 * What the control's confirmation says, indexed by state, and it is NOT the button's label.
 *
 * THE LABEL USED TO BE THE STATE AND THAT WAS THE DEFECT. `Copied` replaced `Copy the sample` on
 * the button itself, so for two seconds the only control in the block stopped saying what it does
 * and started reporting what had happened, which is a different sentence in a different tense on
 * an element whose job is the first one. The confirmation now stands beside the button, in a live
 * region that exists from the first paint so a change to it is announced, and the button's name
 * never moves. The first entry is empty because the resting state has nothing to confirm.
 */
const COPY_SAID = ['', 'Copied', 'Copy unavailable, select the sample'] as const;

/**
 * How long the control holds a state before returning to the first.
 *
 * Long enough that a reader who looked away sees it, short enough that it is gone before they
 * reach for the next sample. `aria-live` is `polite`, so the announcement has already happened by
 * the time this elapses and nothing is lost by reverting.
 */
const COPY_REVERT_MS = 2000;

/**
 * The clipboard, when this browser has one to offer.
 *
 * IT IS ASKED FOR RATHER THAN ASSUMED, because a page served over plain HTTP has no clipboard at
 * all: `navigator.clipboard` is undefined outside a secure context, and a control that called it
 * anyway would throw where a reader could not see it. A reference published to an internal host
 * without TLS is a real deployment of this product, so the control says what happened instead.
 *
 * @returns The writer, or null where there is none
 */
function clipboard(): { writeText(text: string): Promise<void> } | null {
  const host = globalThis as unknown as {
    navigator?: { clipboard?: { writeText(text: string): Promise<void> } };
  };

  return host.navigator?.clipboard ?? null;
}

/**
 * The copy glyph: two sheets, one over the other.
 *
 * MARKUP AND NOT A STYLE, WHICH IS THE ONLY FORM AVAILABLE HERE. A strict policy of
 * `style-src 'self' 'nonce-...'` without `unsafe-inline` can never authorize a `style` attribute,
 * and no script may run to draw one, so the two shapes left are an inline `svg` and a CSS
 * background painted from a token. The first is chosen because it is the one that survives both
 * DOM modes: a background belongs to a stylesheet, and a light DOM build takes its stylesheet from
 * the host page, so a theme that only sets tokens would leave the button empty. This travels with
 * the markup and is drawn wherever the markup is.
 *
 * IT PAINTS FROM `currentColor` AND SIZES ITSELF WITH GEOMETRY ATTRIBUTES, so a theme decides the
 * colour by setting the button's, the way it already does for text, and can override the size with
 * a rule because a presentation attribute loses to every stylesheet. Neither is an inline style.
 *
 * @returns The icon, hidden from the accessibility tree, which {@link COPY_NAME} answers for
 */
function copyIcon(): VNode {
  return h(
    'svg',
    {
      width: '14',
      height: '14',
      viewBox: '0 0 16 16',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.6',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    [
      h('rect', { x: '5.9', y: '5.9', width: '8.2', height: '8.2', rx: '1.5' }),
      h('path', {
        d: 'M10.1 3.3V2.5A1.5 1.5 0 0 0 8.6 1H3.4A1.5 1.5 0 0 0 1.9 2.5v5.2A1.5 1.5 0 0 0 3.4 9.2h.8',
      }),
    ],
  );
}

/** Renders one operation or channel. */
export const NodePanel = defineComponent({
  name: 'OrefNodePanel',

  props: {
    node: { type: Object as PropType<NodeModel>, required: true },
    schemas: { type: Object as PropType<Readonly<Record<string, IRSchema>>>, default: () => ({}) },
    truncated: { type: Array as PropType<readonly string[]>, default: () => [] },
    basePath: { type: String, default: '' },
  },

  setup(props) {
    const deferrable = useDeferrable();
    const samples = useSlot('CodeSample', CodeSample);

    // Which call sample is showing. The first on both sides, so the server render and the first
    // client render agree without anything being carried between them.
    const activeLang = ref('');

    // THE COPY CONTROL READS THE BLOCK RATHER THAN THE MODEL, and that is what lets it exist at
    // all. `CodeSampleModel` keeps `lang`, `label` and `sourceHtml` and drops the raw source, so
    // the text a reader wants is only in the document; and `SlotProps['CodeSample']` is frozen at
    // three members, so a fourth prop carrying it would be a major version. The rendered
    // `.oref-code code` is the same element in both themes, because the highlighted block is the
    // server's own markup and a theme only decides what surrounds it.
    //
    // IT IS DRAWN HERE AND NOT INSIDE THE SLOT, the decision the three sentences below it are
    // drawn by: one control for both themes, no prop added to a frozen map, and no second copy
    // of the fallback for a theme author to get wrong.
    const block = ref<BlockLike | null>(null);
    const copyState = ref(0);
    let revert: ReturnType<typeof setTimeout> | undefined;

    /**
     * Moves the control to a state and books its way back to the first one.
     *
     * BOTH OF THE OTHER TWO STATES REVERT, AND UNTIL NOW NEITHER DID. `Copied` stayed on the button
     * for the life of the page, so a reader who copied once was told they had copied every sample
     * they looked at afterwards, including the ones they had not. `Copy unavailable` was worse: a
     * clipboard write rejected because the document had lost focus latched a permanent failure onto
     * a control that would work on the next click. A label that never changes back is a label that
     * stops describing what the control will do.
     *
     * THE TIMER IS CLEARED BEFORE IT IS SET AND ON UNMOUNT, so two clicks in quick succession leave
     * one booking rather than two, and a page navigated away from leaves nothing holding a `ref`.
     */
    function say(state: number): void {
      copyState.value = state;
      clearTimeout(revert);
      revert = setTimeout(() => (copyState.value = 0), COPY_REVERT_MS);
    }

    onBeforeUnmount(() => {
      clearTimeout(revert);
    });

    function copySample(): void {
      const text = block.value?.querySelector('.oref-code code')?.textContent ?? '';
      const clip = clipboard();

      if (text === '' || clip === null) {
        say(2);
        return;
      }

      void clip.writeText(text).then(
        () => {
          say(1);
        },
        () => {
          say(2);
        },
      );
    }

    return (): VNode => {
      const node = props.node;
      const context: SchemaContext = {
        schemas: props.schemas,
        truncated: props.truncated,
        basePath: props.basePath,
        schemaView: deferrable.schemaView,
      };

      // ONE PART PER DRAWN MARK, in the order the server drew them. The props travel to every
      // filling; the server's components read them and the browser's childless elements ignore
      // them, which is what lets the state block arrive redacted.
      const parts = node.drawn.map((mark): VNode => {
        switch (mark) {
          case 'header':
            // The bench href mirrors the frame's own rule: a bench exists exactly when `run`
            // does. On the client `run` arrives redacted to null and the stub ignores the prop.
            return h(deferrable.operationHeader, {
              node,
              drift: node.runtime?.drift ?? [],
              benchHref: node.run === null ? '' : benchHref(node.id, props.basePath),
            });
          case 'runtime':
            // THE SCALE STANDS DIRECTLY UNDER THE HEADER, per the design's own order. A node
            // with no runtime facts gets no scale at all rather than an empty half, which is
            // SPEC 6.3 applied by `drawnOf` rather than here.
            return h(deferrable.runtimePanel, { nodeId: node.id, runtime: node.runtime });
          case 'description':
            return h(deferrable.nodeDescription, { html: node.descriptionHtml });
          case 'security':
            return h(deferrable.nodeSecurity, { security: node.security });
          case 'params':
            return h(deferrable.paramTable, { parameters: node.parameters });
          case 'request':
            // LIVE, because the schema tree islands inside it hydrate in place when a reader
            // reaches for them; the example block inside each media type is adopted by
            // `mediaTypeBlock` itself, per `MediaTypeModel.hasExample`.
            return h('section', { class: 'oref-section oref-section-request' }, [
              h('h2', { class: 'oref-section-title' }, 'Request body'),
              ...node.requestBody.map((media) =>
                mediaTypeBlock(media, `request:${media.mediaType}`, context),
              ),
            ]);
          case 'responses':
            return h(deferrable.responseList, {
              responses: node.responses,
              schemas: props.schemas,
              truncated: props.truncated,
              basePath: props.basePath,
              marks: node.runtime?.responseMarks ?? [],
              contracts: node.runtime?.contracts ?? [],
            });
          case 'samples':
            // LIVE: the language tab is client state with a handler, the one section of the
            // article that fails the adoption question, named in SPEC 12.
            //
            // THE TWO NOTICES ARE DRAWN HERE AND NOT INSIDE THE SLOT, AND THAT IS THE DESIGN. SPEC
            // 18's fifteen languages reach a page as twelve, and the three the page does not carry
            // are named rather than dropped, so a reader can tell a language this reference does
            // not have from one it can produce. `SlotProps<'CodeSample'>` is frozen at three
            // members, so a fourth prop is a major version; but the statement should not have been
            // a slot's to make in the first place. A theme replacing `CodeSample` replaces how a
            // sample looks, and a theme that could drop this sentence could drop the difference
            // between "no Ruby here" and "no Ruby at all", which is a product guarantee and not a
            // style.
            //
            // THE SECOND NOTICE IS THE SAME GUARANTEE FOR THE TWELVE THE PAGE DOES DRAW. A language
            // whose emitter refuses this request leaves no tab, and a vanished tab is
            // indistinguishable from a language the page never had, which is precisely the
            // distinction the first notice exists to preserve. SPEC 18's standing rule is that
            // where a request cannot be expressed faithfully the page says so rather than emitting
            // something that looks right and sends something else; before this the reason reached
            // the caller as `GeneratedSamples.omitted` and reached the reader not at all.
            //
            // THE SECTION ELEMENT IS DRAWN HERE AND ITS CONTENTS ARE THE SLOT'S, since
            // 2026-09-03, and that is what puts the two sentences inside the block they are about.
            // They used to be siblings after the slot's own closing tag, so a reader met them
            // outside the section the heading opened and a theme's section rule did not reach
            // them. The element cannot be the slot's, because then the sentences would be too.
            //
            // WHAT BOUNDS BOTH, SAID HERE BECAUSE THIS IS WHERE THE GUARANTEE IS MADE. The
            // paragraph carries `oref-description` and nothing of its own, so a theme stylesheet
            // setting `display: none` on that class removes both sentences and no gate would see
            // it; and a theme replacing `AppShell` with a composition that drops its children
            // removes them along with the whole article. Neither is reachable by replacing the
            // `CodeSample` slot, which is what keeping the sentences out of the slot bought.
            return h('section', { class: 'oref-section oref-section-samples', ref: block }, [
              h(samples.value, {
                samples: node.codeSamples,
                activeLang: activeLang.value,
                onSelect: (lang: string): void => {
                  activeLang.value = lang;
                },
              }),
              // NO SAMPLE, NO CONTROL, which is the `role="tablist"` rule one element over: a
              // button offering to copy a block that is not there is the dead control SPEC 11
              // forbids.
              //
              // THE CONFIRMATION STANDS BESIDE THE BUTTON AND NO LONGER REPLACES ITS LABEL. What
              // the control is called and what just happened are two statements, and putting the
              // second where the first was cost the first: for two seconds the button said
              // `Copied`, which is not an offer to do anything, and a reader arriving mid revert
              // met a control whose name described the past. The live region is a sibling that is
              // rendered from the first paint and is empty at rest, because a region inserted at
              // the same moment as its text is not reliably announced.
              //
              // THE ROW IS `.oref-tryit-actions` AND NOT A NEW NAME, for the reason the hook below
              // is an attribute. Both shipped themes already draw that class as exactly this: a
              // centred row with a gap, which is what a control and the sentence beside it need. A
              // class of its own would put a name on the boundary list every theme must style, per
              // THEME-BOUNDARY.md, for a rule that would duplicate one that exists.
              node.codeSamples.length === 0
                ? null
                : h('div', { class: 'oref-tryit-actions' }, [
                    h(
                      'button',
                      {
                        class: 'oref-send',
                        type: 'button',
                        // THE HOOK IS AN ATTRIBUTE AND NOT A CLASS, and the reason is measured
                        // rather than stylistic. The button already carries `.oref-send`, which
                        // both shipped themes draw, so a class of its own would style nothing new
                        // and would put a tenth name on the boundary list every theme has to
                        // style, per THEME-BOUNDARY.md. `data-oref-copy` is the same hook at no
                        // such cost, and it is what a theme selects to tell this control from
                        // Send, which is now also how both themes shape it around an icon.
                        'data-oref-copy': '',
                        'aria-label': COPY_NAME,
                        onClick: copySample,
                      },
                      copyIcon(),
                    ),
                    h(
                      'span',
                      { 'data-oref-copy-said': '', 'aria-live': 'polite' },
                      COPY_SAID[copyState.value],
                    ),
                  ]),
              node.codeSamplesElsewhere.length === 0
                ? null
                : h(
                    'p',
                    { class: 'oref-description' },
                    `Generated for this operation and not drawn here: ${labelsOf(
                      node.codeSamplesElsewhere,
                    )}. A build that asks for them draws them.`,
                  ),
              ...node.codeSamplesRefused.map((refusal) =>
                h(
                  'p',
                  { class: 'oref-description' },
                  `No sample for this request in ${labelsOf(refusal.languages)}: ${refusal.reason}`,
                ),
              ),
              // THE THIRD SENTENCE, AND IT IS ABOUT THE TABS A READER CAN SEE RATHER THAN ABOUT
              // ONES THEY CANNOT. The two above account for a language that is missing; this one
              // says what is true of a sample that is present and correct. Both of its first two
              // sources were computed by the generator and thrown away by the transform: four
              // clients treat a redirect unlike the console, and an operation whose credential no
              // request can carry draws samples that show the request faithfully and will not
              // authenticate. A reader copying one of those and watching it return 401 with the
              // page silent is the same failure as a vanished tab, one layer in.
              ...node.codeSamplesNotes.map((note) =>
                h(
                  'p',
                  { class: 'oref-description' },
                  `In ${labelsOf(note.languages)}: ${note.note}`,
                ),
              ),
            ]);
          // THE THREE CHANNEL SECTIONS OF `T050`, adopted for the same reason the rest are, and
          // for one more: a schema tree inside an adopted position would be a row of buttons
          // nothing hydrates, so the payload is read rather than expanded. See `ChannelSections`.
          case 'channel':
            // TWO POSITIONS UNDER ONE MARK, per `TX-SOCKET-CONSOLE`, and the mark does not grow.
            // `NodeSectionMark` is frozen by `ai-docs/design/CONTRACT.md` and a twelfth member
            // would be a breaking change to say what this one already says: this node is a
            // channel and the server drew its channel section. The facts are adopted and the
            // console is deferred, which is the whole difference between them.
            return h(Fragment, [
              h(deferrable.channelFacts, { channel: node.channel }),
              h(deferrable.socketConsole, {
                channel: node.channel,
                address: node.address ?? '',
              }),
            ]);
          case 'channel-operations':
            return h(deferrable.channelOperations, { channel: node.channel });
          case 'messages':
            return h(deferrable.messageList, {
              channel: node.channel,
              schemas: props.schemas,
              basePath: props.basePath,
            });
        }
      });

      // THE CONSOLE IS NOT HERE, since `TX-FRAME`: the bench is a page of its own, per SPEC
      // 13.3, and the bench tab in the frame is how a reader reaches it from every page of
      // the operation.
      return h('article', { class: 'oref-operation', 'data-oref-node': node.id }, parts);
    };
  },
});
