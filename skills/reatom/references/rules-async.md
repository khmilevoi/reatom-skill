<!-- GENERATED from rules.md by development/build-rule-slices.js. DO NOT EDIT. -->

# Reatom rule registry — async

The `async` slice of `rules.md`. Rules from other domains are owned by
other auditors and are deliberately absent.

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
- exception: state genuinely unrelated to a request's lifecycle
- ref: upstream/core.md#withAsync

### RTM-A04 — Async continuations preserve context with wrap
- domain: async
- kind: anti-pattern
- bad: `fetch(url).then((data) => { recordAtom.set(data) })`
- good: `fetch(url).then(wrap((data) => recordAtom.set(data)))`
- detect: an atom or action touched after `await`, `.then`, a timer, or an event callback without `wrap`
- trigger: .then(, await
- exception: callbacks passed to Reatom's own hooks (`withCallHook(wrap(...))` is wrong)
- ref: upstream/core.md#**wrap** rules

### RTM-A05 — Debounce with wrap(sleep(ms)), not timers
- domain: async
- kind: reinvention
- bad: `let t; clearTimeout(t); t = setTimeout(run, 250)`
- good: `await wrap(sleep(250))` inside an async action extended with `withAbort()`
- detect: module-level timer handles, `clearTimeout` debounce, or `ctx.schedule` for delay
- trigger: setTimeout, clearTimeout, ctx.schedule
- exception: none
- ref: upstream/core.md#**withAbort** strategies

### RTM-A06 — Bridge DOM events with onEvent
- domain: async
- kind: reinvention
- bad: `element.addEventListener('click', () => model.go())`
- good: `onEvent(element, 'click', () => model.go())`, or `addEventListener('click', wrap(...))`
- detect: raw `addEventListener` whose handler touches atoms or actions
- trigger: addEventListener
- exception: listeners that never touch Reatom
- ref: upstream/core.md#**onEvent**
