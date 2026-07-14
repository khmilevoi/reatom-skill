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
