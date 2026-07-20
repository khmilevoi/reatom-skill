<!-- GENERATED from rules.md by development/build-rule-slices.js. DO NOT EDIT. -->

# Reatom rule registry — react

The `react` slice of `rules.md`. Rules from other domains are owned by
other auditors and are deliberately absent.

### RTM-C01 — Read atoms lazily, after the guards
- domain: react
- kind: hygiene
- bad: reading `data()`, `ready()` and `error()` at the top, then branching
- good: `const error = x.error(); if (error) return …; if (!x.ready()) return …; const data = x.data()`
- detect: atom reads inside `reatomComponent` placed before early-return guards that make them unnecessary
- trigger: reatomComponent, useAtom, .ready(, .error(, .data(
- exception: values every branch needs; genuine React hooks — `useAtom` and `useAction` call `useMemo` and `useSyncExternalStore` unconditionally, so the Rules of Hooks forbid moving them below a guard
- ref: react-guide.md#React-to-Reatom decision guide

### RTM-C02 — Wrap React event handlers that touch Reatom
- domain: react
- kind: anti-pattern
- bad: `onClick={() => model.save()}` inside a `reatomComponent`
- good: `onClick={wrap(() => model.save())}`, or `{...bindField(field)}` for form inputs
- detect: a JSX event prop whose handler reads or writes an atom or action without `wrap`
- trigger: onClick, onChange, onSubmit, onBlur, reatomComponent
- exception: handlers produced by `useAction`, `useWrap` or `bindField`, which are already wrapped; handlers that never touch Reatom
- ref: react-guide.md#Event handlers and Reatom context
