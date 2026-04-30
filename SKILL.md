---
name: reatom
description: "Use when working with Reatom v1000 (`@reatom/core@1000`), including atoms, computed state, actions, async data, routing, forms, persistence, SSR/testing, React integration, or v3 migration."
---

# Reatom v1000

## Overview

This skill routes Reatom v1000 work to the local handbook. Start with
`references/reatomv1000.md`, use the smallest matching section, and inspect
`assets/reatom` only when the handbook is insufficient.

## When To Use

Use this skill when the task mentions any of the following:

- Reatom or `@reatom/core@1000`
- atoms, computed, effect, action, extend, `withComputed`
- `wrap`, async context, `withAsync`, `withAsyncData`, `withAbort`
- `atom.set`, identity actions, `setData`, `setUser`, model setter wrappers
- sampling, debounce, `take`, `onEvent`, `ifChanged`, `getCalls`
- Reatom routing, route loaders, protected routes, search params, `route.render`
- forms, `reatomField`, `reatomFieldSet`, `reatomForm`
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

## Default Decisions

- Query/read data: use `computed(async () => ...).extend(withAsyncData(...))`.
- Mutations/commands: use `action(async () => ...).extend(withAsync(...))`.
- Async boundaries: use `wrap(...)` for promises and callbacks that touch Reatom.
- Local state updates: prefer direct `atom.set(...)`; avoid identity setter actions.
- Writable dependent state: use `withComputed(...)` instead of React `key` resets or sync effects.
- Editable nested data: atomize mutable fields and keep readonly fields plain.
- Routes: use `reatomRoute` loaders and `render`; avoid manual `route.match()` component branching.
- URL filters and preferences: use `withSearchParams` and persistence extensions.

## Quick Reference

| Task | Prefer | Avoid |
| --- | --- | --- |
| Async read/query | `computed + withAsyncData` | `effect`/`useEffect` fetch |
| Mutation/command | `action + withAsync` | Manual loading/error atoms |
| Direct local update | `atom.set` | Identity setter action |
| Dependent writable state | `withComputed` | `useEffect` sync/reset |
| Route page data | Route `loader`/`render` | `route.match()` component branch |
| Editable row state | Atomized item model | Parallel UI-state maps |
| Async callback | `wrap` or `onEvent` | Raw `.then`/event callbacks touching atoms |

## Do Not Recommend

- `useEffect` or mount-time fetch code for idempotent Reatom read/query data.
- React `key` resets or sync effects for writable state derived from another atom.
- Identity setter actions such as `setUser = action((value) => user.set(value))`.
- Free-standing setter helpers that only forward values into an atom.
- Manual route rendering branches such as `if (!route.match()) return null`.
- Unwrapped async continuations that touch atoms or actions after `await`, `.then`, events, or timers.
- Normalized backend data plus separate UI-state maps when atomized item models fit.

## Reference Map

- `references/reatomv1000.md`
  - `Core primitives and mental model`
  - `withAsync`
  - `wrap rules`
  - `React-to-Reatom decision guide`
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
- `references/test-scenarios.md`
  - Pressure scenarios for checking whether agents apply the skill's defaults
- `references/baseline-results.md`
  - Result log for pressure-scenario failures, rationalizations, and follow-up doc changes
- `references/golden-example.md`
  - One source-backed React/Reatom example combining the main default patterns
- `assets/reatom`
  - Upstream repo for source, longer docs, and examples when the handbook is not enough

## Source Map

- Core docs: `assets/reatom/docs/src/content/docs/start/`
- Async context: `assets/reatom/docs/src/content/docs/handbook/async-context.md`
- Async resources: `assets/reatom/docs/src/content/docs/handbook/async.md`
- Atomization: `assets/reatom/docs/src/content/docs/handbook/atomization.md`
- Sampling/debounce: `assets/reatom/docs/src/content/docs/handbook/sampling.md`
- Routing: `assets/reatom/docs/src/content/docs/handbook/routing.md`
- Forms: `assets/reatom/docs/src/content/docs/handbook/forms/`
- Persistence: `assets/reatom/docs/src/content/docs/handbook/persist.md`
- React adapter: `assets/reatom/packages/react/src/`
- ESLint rules: `assets/reatom/packages/eslint-plugin/src/rules/`
- Search example: `assets/reatom/examples/react-search/src/components/search/`

## When To Inspect `assets/reatom`

Inspect the bundled repo only for:

- API signature uncertainty not resolved by the handbook.
- Adapter-specific behavior for React, Preact, Vue, Solid, Lit, or JSX.
- Forms details not covered by the summary, especially field arrays.
- Source-level behavior around abort, routing, persistence, SSR, or testing.
- Real examples needed to match project style.

## Validation Checklist

- Are all atoms, computeds, actions, and routes named for tracing?
- Did async code preserve context with `wrap` at every relevant boundary?
- Did async reads avoid imperative fetch effects unless there is a specific reason?
- Did React hook orchestration collapse into Reatom computeds, extensions, or route/form primitives?
- Did direct setters stay as `atom.set(...)` instead of pass-through actions?
- Did route code use loaders/render/outlet for route-scoped lifetime?
- Did dynamic editable structures use atomization instead of parallel state maps?
- Did the answer cite the reference section used when giving non-obvious advice?
