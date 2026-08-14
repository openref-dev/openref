/**
 * The Web Component outputs of SPEC 10.3, composed the way the page entry is.
 *
 * Loading this module registers `<openref-reference href="/docs" shadow="true|false">`, the
 * element that embeds a page this origin already serves. The runner factory rides along, so
 * the try-it console inside an embed is the same console the page has, proxy branch included.
 * Built twice from this one file: as an ES module for a host page that can import one, and as
 * an IIFE with the same bytes for a host page that cannot, which together with the library
 * form and the page entry are the four outputs the SPEC 10.3 table names.
 *
 * THE THEME COMPILED IN IS THE REFERENCE'S OWN, per the pair rule: an element is a build, and
 * embedding a reference served under another theme takes an element built with that theme's
 * definition, which its entry artefact is the place to register.
 */

import { defineReferenceElement, REFERENCE_ELEMENT_TAG } from '@openref/render/browser/element';

customElements.define(
  REFERENCE_ELEMENT_TAG,
  defineReferenceElement({
    loadRunner: async (model) => (await import('./runner-factory')).createPageRunner(model),
  }),
);
