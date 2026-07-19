<!-- GENERATED from rules.md by development/build-rule-slices.js. DO NOT EDIT. -->

# Reatom rule registry — lifecycle

The `lifecycle` slice of `rules.md`. Rules from other domains are owned by
other auditors and are deliberately absent.

### RTM-L01 — Connection-bound side effects use withConnectHook
- domain: lifecycle
- kind: reinvention
- bad: `beginPolling()` / `stopPolling()` with a module-local `setInterval` handle
- good: `atom(undefined, 'x.poll').extend(withConnectHook(() => { const id = setInterval(wrap(fn), 2000); return () => clearInterval(id) }))`
- detect: `setInterval`, `setTimeout`, `addEventListener`, or a subscription started in a factory or action with hand-rolled start/stop
- trigger: setInterval, addEventListener, subscribe, setTimeout
- exception: none — `effect()` is not a substitute; it self-subscribes and never disconnects
- ref: upstream/core.md#**withConnectHook**

### RTM-L02 — Do not reintroduce lifetime with effect
- domain: lifecycle
- kind: anti-pattern
- bad: `effect(() => { const id = setInterval(...) })` to own a timer
- good: `withConnectHook` returning a cleanup, so lifetime tracks connection
- detect: `effect` used to own a long-lived resource
- trigger: effect(
- exception: none
- ref: upstream/core.md#Lifecycle and extension hooks
