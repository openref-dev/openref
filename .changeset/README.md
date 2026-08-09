# Changesets

This folder holds changesets. Each changeset is a markdown file describing one user visible
change and the semver bump it requires.

Add one with:

```bash
pnpm changeset
```

Internal packages (`render`, `runner`, `search`, and the rest of the bundled set) are private and
are never versioned here. Only the published packages listed in `config.json` are.
