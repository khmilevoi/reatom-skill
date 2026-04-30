---
name: reatom
description: "Use when working with Reatom v1000 (`@reatom/core@1000`) — atoms, computed, effects, state modeling with atom.set and withActions, async context via wrap/withAsync/withAsyncData, sampling and debounce, routing and route loaders, protected routes, forms and field arrays, persistence, lifecycle hooks, Suspense, SSR/testing, or migration from v3."
---

# Reatom v1000

## Overview

This skill is the local handbook for Reatom v1000 implementation work.
Read the handbook in `references/reatomv1000.md` first, route to the section
that matches the question, and inspect the bundled upstream repo only when the
handbook does not cover the required implementation detail.

## When To Use

Use this skill when the task mentions any of the following:

- Reatom or `@reatom/core@1000`
- atoms, computed, effect, action, extend, `withComputed`, `withActions`
- `wrap`, async context, `withAsync`, `withAsyncData`, `withAbort`
- `atom.set`, identity actions, `setData`, `setUser`, model setter wrappers
- sampling, debounce, `take`, `onEvent`, `ifChanged`, `getCalls`
- Reatom routing, route loaders, protected routes, search params, `route.render`
- forms, `reatomField`, `reatomFieldSet`, `reatomForm`, field arrays
- persistence, `withLocalStorage`, `withSessionStorage`, `withBroadcastChannel`
- lifecycle hooks, `withConnectHook`, `withDisconnectHook`, `withChangeHook`
- Suspense, SSR, testing, `context.start`, `clearStack`, v3 migration
- React + Reatom integration or Vite/Reatom SPA structure

## Workflow

1. Open `references/reatomv1000.md` and jump to the matching section first.
2. Prefer the handbook's Reatom-native recommendation over generic React state patterns.
3. Answer from the smallest section that fully covers the question.
4. If the handbook is missing a needed implementation detail, inspect only the relevant files in `assets/reatom`.
5. Load only the specific docs, packages, or examples needed for the current question.
6. Keep answers concise, but call out best practices, anti-patterns, and tricky parts explicitly.
7. For state-modeling questions, default to plain `atom.set(...)`; mention `withActions(...)` only when semantic atom-owned methods materially improve the API.

## Reference Map

- `references/reatomv1000.md`
  - `Core primitives and mental model`
  - `withAsync`
  - `wrap rules`
  - `Primitives quick usage`
  - `Atomization`
  - `Lifecycle and extension hooks`
  - `Event sampling and orchestration`
  - `Memoization: memo and memoKey`
  - `Forms: base usage and reactive validation`
  - `Routing`
  - `URL sync and persistence helpers`
  - `Suspense notes`
  - `Transactions notes`
  - `SSR and testing`
  - `v3 migration highlights`
  - `Other APIs`
- `assets/reatom`
  - Upstream repo for source, longer docs, and examples when the handbook is not enough

Recommended repo entrypoints when fallback is needed:

- `assets/reatom/docs/`
- `assets/reatom/packages/`
- `assets/reatom/examples/`

## Guidance

- Prefer `computed + withAsyncData` for idempotent async data fetching.
- Prefer `action + withAsync` for mutations and form submissions.
- Use `wrap` on every async boundary that touches Reatom state.
- Prefer `atom.set` for direct local state updates instead of identity actions.
- Do not recommend separate setter actions or free-standing setter helpers when they only forward into an atom.
- Use `withActions` only as the edge-case escape hatch for semantic methods attached to the atom itself.
- Use route loaders and `render` for route-scoped lifetime instead of manual component branching.
- Use `.array()` when rendering form field arrays.
- Treat the bundled repo as a fallback source, not the first thing to read.
