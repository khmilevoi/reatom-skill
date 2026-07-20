---
title: 'React-to-Reatom decision guide'
description: 'Translating React hook-heavy code into Reatom models'
---

## React-to-Reatom decision guide

Distilled from Artyom's DEV articles:

- https://dev.to/artalar/reatom-state-management-that-grows-with-you-1i4
- https://dev.to/artalar/when-react-hooks-start-feeling-heavy-2njf

Use this guide when translating React hook-heavy code into Reatom models.

| React pressure | Reatom shape |
| --- | --- |
| `useEffect` sync to reset one state from another | Target atom with `withComputed(...)` |
| `key` reset to rebuild a subtree | Explicit atom-level reset or `withComputed` |
| Hook `enabled` flags and placeholder params | `computed(async)` with early returns |
| Duplicated hook state to add persistence or validation | Add extensions to the original atom |
| Conditional hook reads forced by hook order | `reatomComponent` reads only the active branch |
| "Where did this update come from?" logs | Named units plus `wrap` for cause-aware traces |

Default approach:

1. Keep rendering in React and move coordination into Reatom units.
2. Use `computed` for derived and idempotent async read data.
3. Use `withComputed` when a writable atom must rederive from another atom.
4. Use extensions for cross-cutting behavior: persistence, validation, mapping, analytics, middleware, media queries, and storage sync.
5. Use early returns inside `computed(async)` to stop unnecessary reads, subscriptions, and requests.

### Before/after: reset pagination from search

React sync effects often reset dependent state after a render:

```tsx
function SearchPanel({ query }: { query: string }) {
  const [page, setPage] = useState(1)

  useEffect(() => {
    setPage(1)
  }, [query])

  return null
}
```

Prefer making the dependency explicit in the target atom:

```ts
import { atom, withComputed, withSearchParams } from '@reatom/core'

const search = atom('', 'search').extend(withSearchParams('search'))
const page = atom(1, 'page').extend(
  withSearchParams('page'),
  withComputed(() => {
    search()
    return 1
  }),
)
```

This resets only `page`; it does not remount unrelated UI state and does not need a sync effect.

### Before/after: enabled flags and async queries

React hooks often encode business flow through many `enabled` flags and empty fallback params:

```ts
const params = canLoad ? { enabled: true, id } : { enabled: false, id: '' }
const balance = useBalanceQuery(params)
const consumption = useConsumptionQuery(params, { enabled: canLoad })
```

Prefer a single async computed with natural early returns:

```ts
import { atom, computed, withAsyncData, wrap } from '@reatom/core'

const user = atom<User | null>(null, 'user')
const agreement = atom<Agreement | null>(null, 'agreement')

const balanceState = computed(async () => {
  const currentAgreement = agreement()
  if (!currentAgreement) return BalanceStatus.None
  if (currentAgreement.isCanceled) return BalanceStatus.ResourcesStopped

  const currentUser = user()
  if (!canViewBalance(currentUser, currentAgreement)) {
    return BalanceStatus.None
  }

  const [balance, consumption] = await wrap(
    Promise.all([
      api.getBalance(currentAgreement.id),
      api.getDailyConsumption(currentAgreement.id),
    ]),
  )

  return getBalanceStatus(balance, consumption)
}, 'balanceState').extend(withAsyncData({ initState: BalanceStatus.None }))
```

Early returns make the dependency flow visible, avoid placeholder params, and keep the async chain traceable.

## Event handlers and Reatom context

Event handlers that touch atoms or actions must be wrapped. This is upstream's documented
requirement, not a style preference — see `@reatom/react`'s README on context preservation.

```tsx
<button onClick={wrap(() => model.save())}>Save</button>
<input {...bindField(form.fields.name)} />
```

An unwrapped handler runs outside the component's frame. Three things follow, and the
third is the one that produces bug reports:

1. The update loses its causal trace, so logs cannot say what triggered it.
2. It writes into the global root rather than the component's frame. Under `clearStack()`
   this is a hard `ReatomError: missing async stack`.
3. It is **not aborted when the component unmounts**, so an async handler can still resolve
   and write into a component that is gone.

Handlers from `useAction`, `useWrap` and `bindField` are already frame-bound — do not wrap
them again.

### Choosing between wrap, bind and onEvent

| Situation | Use |
| --- | --- |
| Continuation after `await` or `.then` inside a unit | `wrap(...)` |
| React event prop | `wrap(...)` in the prop, or `bindField` for inputs |
| Callback something else will invoke later — `ResizeObserver`, `IntersectionObserver`, a worker `message` | `bind(...)` |
| DOM listener on a real element | `onEvent(target, type, cb)` |

`wrap` resumes a frame you are already inside. `bind` attaches a frame to a callback that
will be called from outside one. Reaching for `context.start()` in a callback is a sign you
wanted `bind`.

## SSR: per-request frame and cache handoff

Atoms stay module-level singletons; their state lives in the frame. That makes the frame
the unit of request isolation, and getting it wrong leaks one user's data into another
user's response with no error at all (`RTM-L03`).

```ts
export const createSsrLoaderData = async (href: string) =>
  context.start(async () => {
    urlAtom.sync.set(() => noop)      // RTM-R05 — see below
    urlAtom.set(new URL(href))
    await wrap(preloadModel())
    return { href, snapshot: ssrStorage.snapshotAtom() }
  })
```

Three obligations:

1. **Every request enters its own `context.start()`.** Without it the server writes into
   the process-wide root created at import time, and the next request reads it.
2. **Neutralise `urlAtom.sync` before setting the URL** (`RTM-R05`). The default sync calls
   `history.pushState`; on the server that throws `ReferenceError: history is not defined`
   *inside a timer*, not in the render stack, which makes it very hard to trace.
3. **Hand the cache over rather than re-fetching.** Pair a memory storage with a persist
   extension and give it to `withCache({ withPersist })`, serialise the snapshot into the
   document, then set it on the client inside the new frame before rendering.

**One caveat, stated plainly:** there is no public "wait until all async state settles" API.
Upstream's own SSR example patches the frame's queue to implement it, copying the helper
from a core test. Treat it as a helper you must vendor, not as an API to call.

## Provider and clearStack

The `reatomContext.Provider` is optional for a plain SPA — without it components fall back
to the default root. It is **required** once you call `clearStack()`, and **required** for
SSR, where the frame carries the request's state.

Upstream's own React examples disagree on this, so decide deliberately rather than copying:
one wires `clearStack()` plus a provider, another wires neither and runs on the implicit
global root.

## Do not copy atom placement from the JSX examples

Upstream's `@reatom/jsx` examples create atoms **inside the component body**. That is
correct there, because a JSX component function runs once and builds a persistent tree.

In React it is a bug: the component body runs on every render, so the atom is recreated
each time and its state is lost. In React, atoms belong in a module or in a model factory —
or, when the state is genuinely component-scoped, in `reatomFactoryComponent`, whose init
function runs once per mount and is aborted on unmount.

