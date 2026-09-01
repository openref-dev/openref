/**
 * An L0 theme, which is the whole of it: a name and some tokens.
 *
 * NO BUNDLE, AND THAT IS NOT AN OMISSION. A theme that overrides a component is code, and code
 * has to reach the browser in a bundle built with that theme, so the pair is refused at setup
 * when one half is missing. A theme that only sets tokens overrides nothing, so there is
 * nothing to build: the values are written into the page's own `<style>` element, which carries
 * the response's nonce and therefore works under a policy with no `unsafe-inline`.
 *
 * EVERY VALUE IS A TOKEN BECAUSE THE CORE SHIPS NO VISUAL OPINION. There is no colour, length,
 * radius or font anywhere in the renderer that is not read from one of these names, which is
 * what makes a theme this short possible at all. The names below are the default theme's own,
 * so overriding one changes every place it is read from rather than one component.
 */
export const acmeTheme = {
  name: 'acme',
  tokens: {
    '--oref-color-accent-link': '#b8482c',
    '--oref-color-accent-bg': '#b8482c',
    '--oref-color-accent-soft': '#f6e2dc',
    '--oref-radius-md': '2px',
    '--oref-radius-sm': '2px',
    '--oref-radius-lg': '3px',
  },
} as const;
