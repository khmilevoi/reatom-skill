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

### RTM-A01 — Async reads use computed + withAsyncData
- domain: async
- kind: reinvention
- bad: `useEffect(() => { fetch(url).then(setData) }, [])`
- good: `computed(async () => wrap(fetch(url))).extend(withAsyncData({ initState: [] }))`
- detect: a `useEffect`/`effect` whose body fetches idempotent read data
- exception: a non-idempotent one-shot triggered by a user gesture → `action` + `withAsync`
- ref: llm.md#withAsync

### RTM-A02 — Mutations use action + withAsync
- domain: async
- kind: reinvention
- bad: `const [pending, setPending] = useState(false); void save().finally(() => setPending(false))`
- good: `const save = action(async () => { … }, 'x.save').extend(withAsync())` and read `!save.ready()`
- detect: React `useState` pending flags or `.finally()` scaffolding around a Reatom action call
- exception: none
- ref: llm.md#withAsync

### RTM-A03 — No manual loading/error atoms
- domain: async
- kind: reinvention
- bad: `const isLoading = atom(false); const error = atom(null)` maintained by hand around a fetch
- good: `.extend(withAsyncData(...))` and read `.ready()` / `.error()` / `.data()`
- detect: atoms named `isLoading`/`loading`/`error`/`pending` written from an async body
- exception: state genuinely unrelated to a request's lifecycle
- ref: llm.md#withAsync

### RTM-A04 — Async continuations preserve context with wrap
- domain: async
- kind: anti-pattern
- bad: `fetch(url).then((data) => { recordAtom.set(data) })`
- good: `fetch(url).then(wrap((data) => recordAtom.set(data)))`
- detect: an atom or action touched after `await`, `.then`, a timer, or an event callback without `wrap`
- exception: callbacks passed to Reatom's own hooks (`withCallHook(wrap(...))` is wrong)
- ref: llm.md#**wrap** rules

### RTM-A05 — Debounce with wrap(sleep(ms)), not timers
- domain: async
- kind: reinvention
- bad: `let t; clearTimeout(t); t = setTimeout(run, 250)`
- good: `await wrap(sleep(250))` inside an async action extended with `withAbort()`
- detect: module-level timer handles, `clearTimeout` debounce, or `ctx.schedule` for delay
- exception: none
- ref: llm.md#**withAbort** strategies

### RTM-A06 — Bridge DOM events with onEvent
- domain: async
- kind: reinvention
- bad: `element.addEventListener('click', () => model.go())`
- good: `onEvent(element, 'click', () => model.go())`, or `addEventListener('click', wrap(...))`
- detect: raw `addEventListener` whose handler touches atoms or actions
- exception: listeners that never touch Reatom
- ref: llm.md#**onEvent**

### RTM-S01 — Direct updates use atom.set
- domain: state
- kind: anti-pattern
- bad: `const setUser = action((value) => user.set(value), 'setUser')`
- good: `user.set(value)` at the call site
- detect: an action whose entire body forwards its argument into one atom
- exception: the action also validates, maps, requests, or orchestrates
- ref: llm.md#Agent defaults and validation

### RTM-S02 — Writable dependent state uses withComputed
- domain: state
- kind: reinvention
- bad: resetting `page` by hand in every handler that writes `search`, or a React `key` reset
- good: `atom(1, 'x.page').extend(withComputed((state) => { search(); return isInit() ? state : 1 }))`
- detect: the same derived reset repeated at multiple call sites, or a sync effect keeping two atoms aligned
- exception: a single trivial paired set inside one user gesture
- ref: llm.md#**withComputed**

### RTM-S03 — Atomize editable rows instead of parallel maps
- domain: state
- kind: anti-pattern
- bad: `selectedIds` / `editedTitles` maps keyed by row id
- good: a `reatomTodo(dto, name)` factory atomizing the mutable fields, readonly fields plain
- detect: state maps keyed by entity id that mirror a loaded collection
- exception: state that genuinely belongs to the collection, not the row
- ref: llm.md#Atomization

### RTM-S04 — Named model actions for grouped transitions
- domain: state
- kind: anti-pattern
- bad: `onClick={() => { model.mode.set('scanning'); model.error.set(null) }}` in the view
- good: a named `goToScan` action on the model that performs both sets
- detect: a DOM handler performing two or more model sets, or a semantically-named transition authored in `ui/`
- exception: a single trivial `atom.set(value)` — see RTM-S01
- ref: llm.md#React-to-Reatom decision guide

### RTM-L01 — Connection-bound side effects use withConnectHook
- domain: lifecycle
- kind: reinvention
- bad: `beginPolling()` / `stopPolling()` with a module-local `setInterval` handle
- good: `atom(undefined, 'x.poll').extend(withConnectHook(() => { const id = setInterval(wrap(fn), 2000); return () => clearInterval(id) }))`
- detect: `setInterval`, `setTimeout`, `addEventListener`, or a subscription started in a factory or action with hand-rolled start/stop
- exception: none — `effect()` is not a substitute; it self-subscribes and never disconnects
- ref: llm.md#**withConnectHook**

### RTM-L02 — Do not reintroduce lifetime with effect
- domain: lifecycle
- kind: anti-pattern
- bad: `effect(() => { const id = setInterval(...) })` to own a timer
- good: `withConnectHook` returning a cleanup, so lifetime tracks connection
- detect: `effect` used to own a long-lived resource
- exception: none
- ref: llm.md#Lifecycle and extension hooks

### RTM-R01 — Route data loads in a loader
- domain: routing-forms
- kind: anti-pattern
- bad: `if (!route.match()) return null` plus a mount-time fetch in the component
- good: `reatomRoute({ path, loader, render })`, where the loader auto-aborts on navigation away
- detect: route lifetime or route data controlled from component code
- exception: none
- ref: llm.md#Loaders — auto data fetching

### RTM-R02 — URL-backed state uses withSearchParams
- domain: routing-forms
- kind: reinvention
- bad: reading and writing `location.search` by hand to keep a filter in the URL
- good: `.extend(withSearchParams('query'))`
- detect: manual `URLSearchParams`/`history.replaceState` synchronisation of atom state
- exception: none
- ref: llm.md#**withSearchParams** for list filters

### RTM-R03 — Persistence uses the storage extensions
- domain: routing-forms
- kind: reinvention
- bad: `localStorage.setItem` in a subscribe callback plus a manual read at init
- good: `.extend(withLocalStorage('key'))`
- detect: direct `localStorage`/`sessionStorage`/`BroadcastChannel` access mirroring an atom
- exception: storage unrelated to atom state
- ref: llm.md#URL sync and persistence helpers

### RTM-R04 — Forms use the form primitives
- domain: routing-forms
- kind: reinvention
- bad: an atom per field plus hand-rolled validation and dirty tracking
- good: `reatomField` / `reatomFieldSet` / `reatomForm` with a schema
- detect: parallel per-field atoms with bespoke validation or submit plumbing
- exception: a single trivial input with no validation
- ref: llm.md#Forms: base usage and reactive validation

### RTM-C01 — Read atoms lazily, after the guards
- domain: react
- kind: hygiene
- bad: reading `data()`, `ready()` and `error()` at the top, then branching
- good: `const error = x.error(); if (error) return …; if (!x.ready()) return …; const data = x.data()`
- detect: atom reads before early-return guards that make them unnecessary
- exception: values every branch needs
- ref: llm.md#React-to-Reatom decision guide

### RTM-C02 — Collapse hook orchestration into one computed
- domain: react
- kind: reinvention
- bad: `canLoadAtom` gating several async units, mirroring React `enabled` flags
- good: one `computed(async)` with early returns, extended with `withAsyncData`
- detect: enabled-flag objects, placeholder params, or duplicated state coordinating async timing
- exception: genuinely independent flows with separate lifetimes
- ref: llm.md#Before/after: enabled flags and async queries

### RTM-S05 — Name every unit
- domain: state
- kind: hygiene
- bad: `atom(0)`, `computed(() => …)`, `action(async () => …)`
- good: `atom(0, 'users.page')`, and a `${modelName}.field` convention inside factories
- detect: any `atom`/`computed`/`action`/`reatomRoute` created without a name argument
- exception: none
- ref: llm.md#Agent defaults and validation
