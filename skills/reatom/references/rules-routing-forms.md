<!-- GENERATED from rules.md by development/build-rule-slices.js. DO NOT EDIT. -->

# Reatom rule registry — routing-forms

The `routing-forms` slice of `rules.md`. Rules from other domains are owned by
other auditors and are deliberately absent.

### RTM-R01 — Route data loads in a loader
- domain: routing-forms
- kind: anti-pattern
- bad: `if (!route.match()) return null` plus a mount-time fetch in the component
- good: `reatomRoute({ path, loader, render })`, where the loader auto-aborts on navigation away
- detect: route lifetime or route data controlled from component code
- trigger: reatomRoute, route.
- exception: none
- ref: upstream/core.md#Loaders — auto data fetching

### RTM-R02 — URL-backed state uses withSearchParams
- domain: routing-forms
- kind: reinvention
- bad: reading and writing `location.search` by hand to keep a filter in the URL
- good: `.extend(withSearchParams('query'))`
- detect: manual `URLSearchParams`/`history.replaceState` synchronisation of atom state
- trigger: URLSearchParams, location.search, history., withSearchParams
- exception: none
- ref: upstream/core.md#**withSearchParams** for list filters

### RTM-R03 — Persistence uses the storage extensions
- domain: routing-forms
- kind: reinvention
- bad: `localStorage.setItem` in a subscribe callback plus a manual read at init
- good: `.extend(withLocalStorage('key'))`
- detect: direct `localStorage`/`sessionStorage`/`BroadcastChannel` access mirroring an atom
- trigger: localStorage, sessionStorage, BroadcastChannel
- exception: storage unrelated to atom state
- ref: upstream/core.md#URL sync and persistence helpers

### RTM-R04 — Forms use the form primitives
- domain: routing-forms
- kind: reinvention
- bad: an atom per field plus hand-rolled validation and dirty tracking
- good: `reatomField` / `reatomFieldSet` / `reatomForm` with a schema
- detect: parallel per-field atoms with bespoke validation or submit plumbing
- trigger: reatomField, reatomForm, onSubmit, validate
- exception: a single trivial input with no validation
- ref: upstream/core.md#Forms: base usage and reactive validation
