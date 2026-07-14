---
name: reatom
description: "Use when working with Reatom v1001 (`@reatom/core@1001`), including atoms, computed state, actions, async data, routing, forms, persistence, SSR/testing, React integration, or v3 migration."
---

# Reatom v1001

## Overview

This skill routes Reatom v1001 work through three sources, in order: our defaults in
`references/rules.md`, the vendored upstream handbook in `references/upstream/`, and
the Reatom the project actually installed in its own `node_modules`.

## When To Use

Use this skill when the task mentions any of the following:

- Reatom or `@reatom/core@1001`
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

1. Apply `references/rules.md`. It is policy and it is binding.
2. Answer from the smallest matching section of `references/upstream/`.
3. For API detail the handbook does not settle, read the project's own
   `node_modules/@reatom/*` — see Source Map.
4. Prefer the Reatom-native shape over generic React state patterns.
5. Keep answers concise, but call out best practices, anti-patterns, and tricky parts
   explicitly, citing the section you used.

## Source Precedence

The vendored handbook is a point-in-time copy. The project's `node_modules` is what its
code actually runs against.

**When `references/upstream/` and the installed `.d.ts` disagree, the installed `.d.ts`
wins.** Check `@reatom/core`'s version in the project's `package.json` against
`references/upstream/VERSION`, and say so out loud when the major differs. If the project
has no `node_modules/@reatom/*`, say the version could not be confirmed rather than
guessing.

`references/rules.md` states policy, not API facts, so it does not conflict with the
types and stays binding either way.

## Default Decisions

- Query/read data: use `computed(async () => ...).extend(withAsyncData(...))`. (RTM-A01)
- Mutations/commands: use `action(async () => ...).extend(withAsync(...))`. (RTM-A02, RTM-A03)
- Async boundaries: use `wrap(...)` for promises and callbacks that touch Reatom. (RTM-A04, RTM-A06)
- Debounce: `await wrap(sleep(ms))` inside an async action, not timers. (RTM-A05)
- Local state updates: prefer direct `atom.set(...)`; avoid identity setter actions. (RTM-S01)
- Writable dependent state: use `withComputed(...)` instead of React `key` resets or sync effects. (RTM-S02)
- Editable nested data: atomize mutable fields and keep readonly fields plain. (RTM-S03)
- Grouped UI transitions: expose a named model action rather than several sets in a handler. (RTM-S04)
- Long-lived side effects: own timers, listeners and subscriptions with `withConnectHook(...)` returning a cleanup. (RTM-L01, RTM-L02)
- Routes: use `reatomRoute` loaders and `render`; avoid manual `route.match()` component branching. (RTM-R01)
- URL filters and preferences: use `withSearchParams` and persistence extensions. (RTM-R02, RTM-R03)
- Forms: use `reatomField`, `reatomFieldSet`, and `reatomForm`. (RTM-R04)
- React reads: read atoms lazily, after early-return guards. (RTM-C01)
- React orchestration: collapse hook coordination into one `computed(async)`. (RTM-C02)
- Naming: name every atom, computed, action, and route. (RTM-S05)

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

- `references/rules.md`
  - The rule registry: one entry per rule with id, domain, kind, bad/good examples,
    detection criteria, and exceptions. Cited by the audit agents. This file is the
    source of truth for the Default Decisions above.
- `references/react-guide.md`
  - `React-to-Reatom decision guide`
  - `Before/after: enabled flags and async queries`
- `references/atomization-notes.md`
  - `Atomization notes`
- `references/golden-example.md`
  - One source-backed React/Reatom example combining the main default patterns
- `references/upstream/core.md`
  - `Goal and fit`
  - `Core primitives and mental model`
  - `withAsync`
  - `**wrap** rules`
  - `Primitives quick usage`
  - `Atomization`
  - `Lifecycle and extension hooks`
  - `Event sampling and orchestration`
  - `Memoization: **memo** and **memoKey**`
  - `Forms: base usage and reactive validation`
  - `Routing`
  - `URL sync and persistence helpers`
  - `Suspense notes`
  - `Transactions notes`
  - `SSR and testing`
  - `v3 migration highlights`
- `references/upstream/async.md`
  - `Choosing the Primitive`
  - `withAsyncData`
  - `wrap Rules`
  - `withAbort`
  - `abortVar and Fetch Signals`
  - `Sampling and Procedural Async`
  - `Status, Retry, Reset`
  - `Cache Order`
  - `Suspense Boundaries`
  - `Common Mistakes`
- `references/upstream/jsx.md`
  - `Reference`
  - `Utilities`
  - `TypeScript`
  - `Limitations`
- `references/upstream/review.md`
  - `Mandatory Checks`
  - `Typical Mismatches And Fixes`
  - `Identity Action`
  - `Atom Factory Named Like A Getter`

## Source Map

`references/upstream/` is vendored from `reatom/reatom`; see its `VERSION` for the pin.
Everything below is in the **project's own** `node_modules`, not in this plugin.

- API signatures and JSDoc: `node_modules/@reatom/core/dist/index.d.ts`
- React adapter: `node_modules/@reatom/react/README.md` — the package's `.d.ts` is thin
- JSX adapter: `node_modules/@reatom/jsx/dist/index.d.ts` and `README.md`
- Installed version: the project's `package.json`

`node_modules/@reatom/core/README.md` is install notes, not the handbook. Use the `.d.ts`.

## When To Inspect `node_modules`

Read the installed package for:

- API signature uncertainty the handbook does not resolve.
- Any question where the installed version might differ from `upstream/VERSION`.
- Adapter-specific behavior for React, Preact, Vue, Solid, Lit, or JSX.
- Source-level behavior around abort, routing, persistence, SSR, or testing.

## Validation Checklist

- Are all atoms, computeds, actions, and routes named for tracing?
- Did async code preserve context with `wrap` at every relevant boundary?
- Did async reads avoid imperative fetch effects unless there is a specific reason?
- Did React hook orchestration collapse into Reatom computeds, extensions, or route/form primitives?
- Did direct setters stay as `atom.set(...)` instead of pass-through actions?
- Did route code use loaders/render/outlet for route-scoped lifetime?
- Did dynamic editable structures use atomization instead of parallel state maps?
- Did `reatomComponent` read atoms lazily — after early-return guards, not before them?
- Did the answer cite the reference section used when giving non-obvious advice?
