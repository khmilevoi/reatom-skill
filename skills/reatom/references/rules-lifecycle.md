<!-- GENERATED from rules.md by development/build-rule-slices.js. DO NOT EDIT. -->

# Reatom rule registry — lifecycle

The `lifecycle` slice of `rules.md`. Rules from other domains are owned by
other auditors and are deliberately absent.

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
