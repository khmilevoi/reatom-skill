---
title: 'Reatom rule registry'
description: 'Single source of truth for the skill defaults and the audit agents'
---

# Reatom Rule Registry

Each rule is owned by exactly one audit domain. `SKILL.md` is this file's compact
projection: every id below is tagged there, and the consistency test fails if the
two drift.

`kind` values:

- `reinvention` — hand-rolls what the library already provides
- `anti-pattern` — does something the skill forbids outright
- `hygiene` — traceability and subscription discipline

`trigger` is a comma-separated list of literal, **case-sensitive** substrings. The
gate's router (`hooks/gate-logic.js`) tests each one with plain `String.includes`
against a file's raw text — there is no tokenizing, word-boundary matching, or
case-folding. `isLoading` does not match `isBalanceLoading`, and `useEffect` does
not match `UseEffect`. Triggers are deliberately wide: a token that also fires on
unrelated code is a cheaper mistake than a token that misses a real violation, so
prefer a trigger that over-matches to one that is precise but silent.

`exception` is load-bearing in the opposite direction. A rule that fires on correct
code costs trust in the whole audit, and several exceptions below exist because
upstream's own examples and handbook use the shape the rule would otherwise flag.
When adding a rule, look for the upstream code that legitimately breaks it.

### RTM-A01 — Async reads use computed + withAsyncData
- domain: async
- kind: reinvention
- bad: `useEffect(() => { fetch(url).then(setData) }, [])`
- good: `computed(async () => wrap(fetch(url))).extend(withAsyncData({ initState: [] }))`
- detect: a `useEffect`/`effect` whose body fetches idempotent read data
- trigger: useEffect, fetch(
- exception: a non-idempotent one-shot triggered by a user gesture → `action` + `withAsync`
- ref: upstream/core.md#withAsync

### RTM-A02 — Mutations use action + withAsync
- domain: async
- kind: reinvention
- bad: `const [pending, setPending] = useState(false); void save().finally(() => setPending(false))`
- good: `const save = action(async () => { … }, 'x.save').extend(withAsync())` and read `!save.ready()`
- detect: React `useState` pending flags or `.finally()` scaffolding around a Reatom action call
- trigger: useState, .finally(
- exception: none
- ref: upstream/core.md#withAsync

### RTM-A03 — No manual loading/error atoms
- domain: async
- kind: reinvention
- bad: `const isLoading = atom(false); const error = atom(null)` maintained by hand around a fetch
- good: `.extend(withAsyncData(...))` and read `.ready()` / `.error()` / `.data()`
- detect: atoms named `isLoading`/`loading`/`error`/`pending` written from an async body
- trigger: isLoading, loading, pending
- exception: state genuinely unrelated to a request's lifecycle; a derived `computed(() => !x.ready())` or a re-export of `x.error` — those read the extension, they do not maintain it
- ref: upstream/core.md#withAsync

### RTM-A04 — Async continuations preserve context with wrap
- domain: async
- kind: anti-pattern
- bad: `fetch(url).then((data) => { recordAtom.set(data) })`
- good: `fetch(url).then(wrap((data) => recordAtom.set(data)))`; for a callback invoked later from outside, `new ResizeObserver(bind(() => sizeAtom.set(read())))`
- detect: an atom or action touched after `await`, `.then`, a timer, or an event callback without `wrap` or `bind`
- trigger: .then(, await, ResizeObserver, IntersectionObserver
- exception: callbacks passed to Reatom's own extension hooks (`withCallHook(wrap(...))` is wrong); handlers returned by adapter hooks (`useAction`, `useWrap`, `bindField`), which are already frame-bound; code not lexically inside a Reatom unit; an already-wrapped boundary such as `await wrap(x)`, `.then(wrap(cb))` or `setTimeout(wrap(cb), ms)`
- ref: upstream/core.md#**wrap** rules

### RTM-A05 — Debounce with wrap(sleep(ms)), not timers
- domain: async
- kind: reinvention
- bad: `let t; clearTimeout(t); t = setTimeout(run, 250)`
- good: `await wrap(sleep(250))` inside an async action extended with `withAbort()` — or inside an `effect` when the trigger is an atom change rather than a user gesture, since effect re-invalidation cancels the previous frame
- detect: a module-level timer handle, `clearTimeout` debounce, or `ctx.schedule` used to **delay or debounce** a call
- trigger: setTimeout, clearTimeout, ctx.schedule
- exception: a timer whose callback never reads or writes a Reatom unit — a scheduler yield such as `setTimeout(resolve, 0)`; a **recurring** timer driving a long-lived subscription is RTM-L01's, not this rule's
- ref: upstream/core.md#**withAbort** strategies

### RTM-A06 — Bridge DOM events with onEvent
- domain: async
- kind: reinvention
- bad: `element.addEventListener('click', () => model.go())`
- good: `onEvent(element, 'click', () => model.go())`, or `addEventListener('click', wrap(...))`
- detect: raw `addEventListener` whose handler touches atoms or actions
- trigger: addEventListener
- exception: listeners that never touch Reatom; gesture-scoped listeners cleaned up through `abortVar.set()` rather than a connect hook
- ref: upstream/core.md#**onEvent**

### RTM-A07 — Read reactive inputs before the first await
- domain: async
- kind: anti-pattern
- bad: `computed(async () => { const file = await wrap(load()); const size = target(); … })`
- good: capture `const size = target()` synchronously at the top, then `await wrap(load())`
- detect: purely positional — inside a `computed(async)` body, find the first `await`; every unit call below it (`someAtom()`, `x.data()`, `x.ready()`) is a violation unless it is wrapped in `peek(...)`. Correct `wrap` usage on the awaited call does not make the read below it safe; the two are unrelated concerns
- trigger: computed(async, await wrap
- exception: reads that intentionally must not retrigger — use `peek(...)` to say so explicitly
- ref: async-notes.md#Dependency tracking stops at the first await

### RTM-A08 — Cache async reads with withCache, not a hand-rolled map
- domain: async
- kind: reinvention
- bad: `const cache = new Map(); const get = async (id) => cache.get(id) ?? cache.set(id, await api.item(id))`
- good: `computed(async () => wrap(api.item(id())), 'item').extend(withAsyncData(), withCache({ staleTime: 60_000, swr: true }))`
- detect: a module-level `Map`/object memo, a manual TTL via `Date.now()`, or a hand-written stale-while-revalidate loop around an async atom
- trigger: new Map(), Date.now(), staleTime, swr
- exception: caching unrelated to an atom or action result
- ref: async-notes.md#Caching async reads

### RTM-S01 — Direct updates use atom.set
- domain: state
- kind: anti-pattern
- bad: `const setUser = action((value) => user.set(value), 'setUser')`
- good: `user.set(value)` at the call site
- detect: an action whose entire body forwards its argument into one atom, or an exported one-line function that only calls `atom.set(...)`
- trigger: action(, .set(
- exception: the action also validates, maps, requests, or orchestrates
- ref: upstream/review.md#Identity Action

### RTM-S02 — Writable dependent state uses withComputed
- domain: state
- kind: reinvention
- bad: resetting `page` by hand in every handler that writes `search`, or a React `key` reset
- good: `atom(1, 'x.page').extend(withComputed((state) => { search(); return isInit() ? state : 1 }))`
- detect: the same derived reset repeated at multiple call sites, or a sync effect keeping two atoms aligned
- trigger: withComputed, atom(
- exception: a single trivial paired set inside one user gesture; a cascade resetting several unrelated atoms at once, which is `withChangeHook` territory
- ref: upstream/core.md#**withComputed**

### RTM-S03 — Atomize editable rows instead of parallel maps
- domain: state
- kind: anti-pattern
- bad: `selectedIds` / `editedTitles` maps keyed by row id
- good: a `reatomTodo(dto, name)` factory atomizing the mutable fields, readonly fields plain
- detect: state maps keyed by entity id that mirror a loaded collection
- trigger: atom(, reatom
- exception: state that genuinely belongs to the collection, not the row
- ref: upstream/core.md#Atomization

### RTM-S04 — Named model actions for grouped transitions
- domain: state
- kind: anti-pattern
- bad: `onClick={() => { model.mode.set('scanning'); model.error.set(null) }}` in the view
- good: a named `goToScan` action on the model that performs both sets
- detect: a DOM handler performing two or more raw `.set()` calls, or a semantically-named transition authored in `ui/`
- trigger: .set(, onClick, on:click
- exception: a single trivial `atom.set(value)` — see RTM-S01; composing two already-named model actions in one handler
- ref: react-guide.md#React-to-Reatom decision guide

### RTM-S05 — Name every unit
- domain: state
- kind: hygiene
- bad: `atom(0)`, `computed(() => …)`, `action(async () => …)`, `effect(async () => …)`
- good: `atom(0, 'users.page')`; inside a factory derive the name from the parent (`` `${target.name}.width` ``) or the instance (`` `image#${id}.selected` ``), and mark internal units with a leading `_`
- detect: any `atom`/`computed`/`action`/`effect`/`reatomRoute`/`reatom*` factory created with no name — whether as the second positional argument or as `name` inside an options object
- trigger: atom(, computed(, action(, effect(, reatomRoute
- exception: a unit not bound to a plain identifier — upstream's own linter deliberately reports nothing when the call has no enclosing `const` or property with an `Identifier` id
- ref: upstream/review.md#Atom Factory Named Like A Getter

### RTM-S06 — Collapse hook orchestration into one computed
- domain: state
- kind: reinvention
- bad: `canLoadAtom` gating several async units, mirroring React `enabled` flags
- good: one `computed(async)` with early returns, extended with `withAsyncData`
- detect: a separate atom, flag or placeholder param that exists to **gate or sequence** async work — `canLoad`, `enabled`, an empty-string id standing in for "not ready yet" — which an early return inside one `computed(async)` would replace
- trigger: computed(, enabled, canLoad, atom(
- exception: genuinely independent flows with separate lifetimes; plain scaffolding around a single request that gates nothing — a pending or loading flag (RTM-A02/A03), a debounce or polling timer (RTM-A05/RTM-L01), an unwrapped continuation (RTM-A04). Those belong to their own rules; the marker for this one is a gating condition, not hand-rolled async in general
- ref: react-guide.md#Before/after: enabled flags and async queries

### RTM-S07 — Derived collections are computed over the source, with a keyed model cache
- domain: state
- kind: anti-pattern
- bad: `reatomLinkedList(...).extend(withConnectHook(() => { a.subscribe(sync); b.subscribe(sync) }))` mirroring loaded data
- good: `computed(() => source().map(getModel), 'items')` plus a `Map` keyed by id, so each entity keeps one model instance
- detect: a collection primitive kept in sync by a `subscribe`/`effect` fan-out, or a model factory called without an identity cache
- trigger: reatomLinkedList, createMany, clear()
- exception: the collection is the source of truth and is mutated directly — then `reatomLinkedList` is correct
- ref: atomization-notes.md#Collections of models

### RTM-L01 — Connection-bound side effects use withConnectHook
- domain: lifecycle
- kind: reinvention
- bad: `beginPolling()` / `stopPolling()` with a module-local `setInterval` handle
- good: `atom(undefined, 'x.poll').extend(withConnectHook(() => { const id = setInterval(wrap(fn), 2000); return () => clearInterval(id) }))` — or any other owner that returns cleanup: `withDisconnectHook`, `reatomObservable`, an adapter `ref` callback, or an abortable enclosing scope
- detect: `setInterval`, `setTimeout`, `addEventListener`, `withInitHook`, or a subscription started in a factory or action with hand-rolled start/stop
- trigger: setInterval, addEventListener, subscribe, setTimeout, withInitHook
- exception: `addEventListener`/`subscribe` inside a `reatomObservable` descriptor that returns its own cleanup; `atom.subscribe` handed to a framework binding such as `useSyncExternalStore`, which is RTM-R04/RTM-C02 territory rather than a lifetime leak; a timer used purely to delay or debounce a single call, which is RTM-A05's
- ref: upstream/core.md#**withConnectHook**

### RTM-L02 — Do not reintroduce lifetime with a top-level effect
- domain: lifecycle
- kind: anti-pattern
- bad: a module-level `effect(() => { const id = setInterval(...) })` owning a timer with no abortable parent
- good: `withConnectHook` returning a cleanup, or an `effect` created inside an abortable scope — a `computed` factory extended with `withAbort()`, a route `loader`, `withConnectHook`, or `reatomFactoryComponent`
- detect: `effect` owning a long-lived resource at module scope, where no enclosing scope can abort it
- trigger: effect(
- exception: an `effect` inside a managed abortable scope — `effect` is extended with `withAbort()` and `withDynamicSubscription()`, which unsubscribes on abort, and upstream documents this shape for polling loops and for `withFormAutoSubmit`; also an `effect` whose returned `unsubscribe` is explicitly owned by a connect hook or an adapter `ref` callback
- ref: upstream/core.md#Lifecycle and extension hooks

### RTM-L03 — Each SSR request runs inside its own context.start()
- domain: lifecycle
- kind: anti-pattern
- bad: a server handler that renders or reads atoms without entering a frame, so every request shares the module-level root
- good: `context.start(async () => { setupSsrUrl(href); await wrap(preload()); return snapshot })` per request
- detect: a server-side render, loader, or route handler that touches atoms outside `context.start`
- trigger: renderToString, renderToPipeableStream, createFileRoute, defineEventHandler, getServerSideProps, context.start
- exception: browser-only entry points
- ref: upstream/core.md#SSR and testing

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
