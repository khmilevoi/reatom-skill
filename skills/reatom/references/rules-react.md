<!-- GENERATED from rules.md by development/build-rule-slices.js. DO NOT EDIT. -->

# Reatom rule registry — react

The `react` slice of `rules.md`. Rules from other domains are owned by
other auditors and are deliberately absent.

### RTM-C01 — Read atoms lazily, after the guards
- domain: react
- kind: hygiene
- bad: reading `data()`, `ready()` and `error()` at the top, then branching
- good: `const error = x.error(); if (error) return …; if (!x.ready()) return …; const data = x.data()`
- detect: atom reads before early-return guards that make them unnecessary
- trigger: reatomComponent, useAtom, .ready(, .error(, .data(
- exception: values every branch needs
- ref: react-guide.md#React-to-Reatom decision guide
