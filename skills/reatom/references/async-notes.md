---
title: 'Async notes'
description: 'Reatom-skill additions to the upstream async guidance'
---

# Async notes

Additions to [`upstream/async.md`](./upstream/async.md#Choosing the Primitive). Read that
file first; this one only covers what it leaves out.

## Caching async reads

`upstream/async.md#Cache Order` states the one hard constraint — `withAsync()` /
`withAsyncData()` must be applied **before** `withCache()`, and the wrong order throws at
construction time. It does not describe what `withCache` actually offers, which is why
hand-rolled caches keep getting written next to it.

```ts
computed(async () => wrap(api.item(id())), 'item').extend(
  withAsyncData(),
  withCache({ staleTime: 60_000, swr: true }),
)
```

What it already does, so you do not have to:

| Option | Behaviour |
| --- | --- |
| `staleTime` | how long a cached entry stays fresh; defaults to 5 minutes |
| `length` | LRU bound on the number of cached entries; defaults to 5 |
| `swr` | serve the stale value while revalidating in the background |
| `paramsToKey` / `isEqual` | how call params become a cache key |
| `withPersist` | store the cache through a persist adapter, which is what makes SSR handoff work |

The cache atom also exposes imperative invalidation, so "refetch this one entry" does not
require tearing down the resource.

A `Map` keyed by id, a `Date.now()` staleness check, or a hand-written
stale-while-revalidate loop around an async atom are all `withCache` rewritten by hand
(`RTM-A08`).

## Where the async context is lost

Three primitives, three different jobs. Choosing the wrong one is the most common cause of
"missed context" errors and of updates that silently never fire.

| Situation | Use |
| --- | --- |
| Continuation after `await` or `.then`, inside a unit | `wrap(...)` |
| Callback something else will invoke later — `ResizeObserver`, `IntersectionObserver`, a worker `message` | `bind(...)` |
| Listener on a real DOM element | `onEvent(target, type, cb)` |

`wrap` resumes a frame you are already inside; `bind` attaches a frame to a callback that
will be called from outside one. Reaching for `context.start()` inside a callback is a sign
you wanted `bind`.

None of the three is needed at a boundary that is already wrapped, in code that is not
lexically inside a Reatom unit, or on a handler an adapter hook already returned bound —
`useAction`, `useWrap` and `bindField` all hand back frame-bound callbacks.

## Dependency tracking stops at the first await

Inside `computed(async)`, reads are tracked only until the first `await`. A read placed
after one never becomes a dependency, and nothing fails — the value simply stops updating
when its input changes (`RTM-A07`).

Capture every reactive input synchronously at the top, then await. When a read genuinely
must not retrigger the computation, use `peek(...)` so the intent is explicit rather than
accidental.
