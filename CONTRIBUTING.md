# Contributing to protifer

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.3

## Setup

```bash
bun install
```

`bun install` automatically runs `bun x husky` via the `postinstall` script, which installs the Git pre-commit hook into `.husky/`.

> **First-time clone only:** if hooks are not installed, run `bun run postinstall` manually once.

## Pre-commit Hook

Every commit runs `lint-staged`, which:

1. Runs `eslint --fix` on staged `*.{ts,tsx,js,mjs,cjs}` files.
2. Runs `prettier --write` on all staged formattable files.
3. Runs `tsc --noEmit` scoped to each workspace that contains staged TypeScript changes.

**A commit is blocked if ESLint reports unfixable errors or TypeScript reports type errors.**

### Bypassing the Hook

For work-in-progress commits on a personal branch only:

```bash
git commit --no-verify -m "wip: ..."
```

> **Do not use `--no-verify` on commits destined for `main`.** CI enforces the same checks.

## Formatting

Prettier runs at the repo root — there are no per-package format scripts.

```bash
bun run format        # check all files
bun run format:fix    # auto-fix all files
```

## Linting

```bash
bun run lint          # lint all workspaces (cached by Turbo)
```

## Type-checking

```bash
bun run typecheck     # typecheck all workspaces (cached by Turbo)
```
