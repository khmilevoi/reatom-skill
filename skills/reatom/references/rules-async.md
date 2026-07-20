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
