# An L0 theme

Tokens only. No bundle, no build step, no package.

```bash
pnpm --filter @openref/example-custom-theme start
```

The whole theme is `src/acme.theme.ts`. It is passed as
`theme: { definition: acmeTheme }`, and the values are written into the page's own `<style>`
element, which carries the response nonce, so a policy with no `unsafe-inline` accepts it once
your host sends one.

Delete the `theme` option in `src/main.ts` and reload to see the default beside it.

Going further costs a bundle: a theme that overrides a component is code, and the code has to
reach the browser built with that theme, so the pair is refused at setup when one half is
missing.

## The smallest mount in this repository

`src/main.ts` has no `forRoot` at all, so this is SPEC 13.1's minimal form with a theme on top.
It reports no guard, no scope and no rate limit, because nothing was registered to read them:
that is what `examples/runtime-intelligence` is for.
