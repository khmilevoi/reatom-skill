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
- exception: a `URL`/`URLSearchParams` built for an outbound request, or any URL that is not the app's own location
- ref: upstream/core.md#**withSearchParams** for list filters

### RTM-R03 — Persistence uses the storage extensions
- domain: routing-forms
- kind: reinvention
- bad: `localStorage.setItem` in a subscribe callback plus a manual read at init
- good: `.extend(withLocalStorage('key'))`, or `.extend(withIndexedDb({ key: target.name, version: 1 }))`
- detect: direct `localStorage`/`sessionStorage`/`BroadcastChannel`/`indexedDB` access mirroring an atom
- trigger: localStorage, sessionStorage, BroadcastChannel, indexedDB, withIndexedDb
- exception: storage unrelated to atom state; feature detection such as `typeof localStorage !== 'undefined'`; constructing a channel or handle purely to pass into the extension itself, as in `withBroadcastChannel(new BroadcastChannel(...))`
- ref: upstream/core.md#URL sync and persistence helpers

### RTM-R04 — Forms use the form primitives
- domain: routing-forms
- kind: reinvention
- bad: an atom per field plus hand-rolled validation and dirty tracking, or `useSyncExternalStore(field.value.subscribe, field.value)` plus a custom `getInputProps`
- good: `reatomForm(init, { schema, validateOnChange })` composed from `reatomField`/`reatomFieldSet`/`reatomFieldArray`, with `{...bindField(form.fields.x)}` in React and `wrap(form.submit)` on the form
- detect: parallel per-field atoms with bespoke validation or submit plumbing, or a manual subscription to a field atom inside a component
- trigger: reatomField, reatomForm, onSubmit, on:submit, validate, bindField, useSyncExternalStore
- exception: a single trivial input with no validation
- ref: upstream/core.md#Forms: base usage and reactive validation

### RTM-R05 — Disable urlAtom sync before setting it on the server
- domain: routing-forms
- kind: anti-pattern
- bad: `urlAtom.set(new URL(req.url))` on the server with the default sync still in place
- good: `urlAtom.sync.set(() => noop)` first, then `urlAtom.set(new URL(href))`
- detect: `urlAtom.set` or `urlAtom.go` reachable from server code without a preceding `urlAtom.sync.set`
- trigger: urlAtom, urlAtom.sync, urlAtom.set
- exception: browser-only code paths
- ref: upstream/core.md#SSR and testing

### RTM-R06 — Combine withSearchParams and withLocalStorage deliberately
- domain: routing-forms
- kind: anti-pattern
- bad: `atom(0.7, 'volume').extend(withSearchParams('volume'), withLocalStorage('volume'))` on the assumption that a shared URL wins
- good: apply `withLocalStorage` first and `withSearchParams` after, and connect the atom before relying on URL sync
- detect: an atom carrying both a storage extension and `withSearchParams`, or URL-shareable state read before connection
- trigger: withSearchParams, withLocalStorage, withSessionStorage
- exception: none
- ref: upstream/core.md#URL sync and persistence helpers
