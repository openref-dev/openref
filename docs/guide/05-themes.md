## Themes

<!-- gen: count:table -->Three<!-- /gen --> levels, and you can stop at any of them.

| Level | What it gives you | What it costs |
| --- | --- | --- |
| **L0, tokens** | CSS custom properties. Colours, spacing, radii, fonts | nothing, no build step |
| **L1, slots** | your own Vue component in a named position | a browser bundle built with your theme |
| **L2, a full theme** | your own layout; the core ships no style at all | a package |

A fourth level, arbitrary HTML marked up with `data-oref-*` attributes, was planned and then
withdrawn on 2026-08-14. It amounted to writing a template language, and the case it existed
for is covered by an L2 theme in the Web Component's light DOM mode, at a fraction of the cost.
It is recorded here as withdrawn rather than left in a roadmap.

### L0: tokens

```ts
OpenRefModule.setup('/docs', app, {
  document,
  theme: {
    definition: {
      name: 'acme',
      tokens: {
        '--oref-color-accent-link': '#0088ff',
        '--oref-color-accent-bg': '#0088ff',
        '--oref-radius-md': '2px',
      },
    },
  },
});
```

No bundle, no build step, no package. The tokens are written into a `<style>` element carrying
the page's nonce, so they work under a strict policy. Token names must match
`--oref-<group>-<name>`; a theme name must be lowercase with hyphens.

Every colour, length, radius and font in the shipped themes is a token. The core ships no
visual opinion of its own, and a hardcoded value in a theme's stylesheet is a lint error rather
than a matter of taste.

### L1: one slot, your component

<!-- gen: count:slot-names -->Twenty one<!-- /gen --> positions are registered, and the list is public API:

```
AppShell        NavTree          CommandPalette   DocumentOverview  SchemaPage
OperationHeader RuntimePanel     ProvenanceTag    DriftCard         ParamTable
ResponseList    CodeSample       SchemaTree       ShapeForm         AuthPanel
ServerSelect    SendButton       ResponseView     StreamLog         HealthScore
StateNotice
```

```ts
export default defineTheme({
  name: 'acme',
  components: { StateNotice },
  tokens: { '--oref-color-accent-link': '#3b6ef5' },
  assets: { css: ['./acme.css'] },
});
```

The moment a theme declares a component it also needs a browser bundle built with it, and
passing one is not optional:

```ts
OpenRefModule.setup('/docs', app, {
  document,
  theme: { definition: acme, bundle: '@acme/openref-theme/entry' },
});
```

A definition with component overrides and no bundle is refused at setup with a message saying
so. The reason is a failure mode rather than a rule: the server would render your component and
the default bundle would hydrate over it, producing a page that is correct in every test and
silently wrong in a browser.

<!-- gen: count:server-resolved-slots -->Eight<!-- /gen --> of those positions are server resolved. They carry no client state and must keep their
root element type, because the server's markup and the client's expectation of it have to
agree.

### L2: your own layout

An L2 theme is a package. It brings its own `AppShell`, its own stylesheet, its own fonts and
the whole token set in both colour schemes, and the core contributes no style at all.
`@openref/theme-telltale` is one, shipped as a reference: it is written against `@openref/vue`
alone and imports nothing from the renderer.

`@openref/theme-kit` scaffolds one and checks it against the contract.

### The rule underneath all three

No inline styles. Anywhere.

```vue
<!-- this is how a dynamic value is carried -->
<div class="oref-badge" :class="statusClass">

<!-- this is refused, and a CI check scans built output for it -->
<div :style="{ color: statusColor }">
```

A CSP nonce can authorize a `<style>` element. It can never authorize a `style="..."`
attribute, because the attribute has nowhere to carry the nonce. Emitting markup a host can
serve under `style-src 'self' 'nonce-...'` with no `unsafe-inline` is the point, so a dynamic
value goes through a CSS custom property set on a class, never through an inline style.

### Both DOM modes

The Web Component ships in two builds. Shadow DOM isolates styles, which is what you want when
you are embedding the reference in a page you do not control. Light DOM (`shadow: false`) lets
the host page's CSS reach in, which is what you want when the reference is meant to look like
the portal around it. Neither is a workaround for the other, and every theme level is tested in
both.
