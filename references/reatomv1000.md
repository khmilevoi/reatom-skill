---
title: 'Reatom full framework documentation summary'
description: 'A short overview of all Reatom features'
---

# Reatom full framework documentation summary

This documentation for `@reatom/core@1000` package and some ecosystem around it.

## Goal and fit

- From small widgets to complex SPAs, one universal model.
- Portable state and logic across frameworks and runtimes.
- Simple testing and mocking with explicit context tools.
- Isomorphic and SSR-friendly with predictable async control.
- Composable primitives, minimal API surface, high leverage extensions.

## Agent defaults and validation

When implementing or reviewing Reatom code, apply these defaults before reaching
for generic state-management patterns:

- Async query/read data: `computed(async () => ...).extend(withAsyncData(...))`.
- Async mutation/command: `action(async () => ...).extend(withAsync(...))`.
- Promise or callback boundary that touches Reatom: preserve context with `wrap`.
- Direct local state update: use `atom.set(...)`, not an identity setter action.
- Writable dependent state: use `withComputed(...)`, not React `key` resets or sync effects.
- Dynamic editable object/list data: atomize mutable fields and compose factories.
- Route lifetime: use `reatomRoute` loaders, `render`, layouts, and `outlet`.
- URL state and persistence: use `withSearchParams`, `withLocalStorage`, and related extensions.
- React orchestration smell: when code grows into local state plus effects plus sync flags,
  move the state graph into Reatom computeds, extensions, forms, routes, and async data.

Before finalizing advice, check for common anti-patterns: imperative mount-time
fetching for idempotent data, pass-through setter actions, manual route branching
in components, React `key` reset tricks, separate parallel local state maps for
list items, duplicated hook state, unwrapped async continuations, and unnamed
atoms/actions/computeds.

This summary is intentionally **compact**. The full handbook and reference cover deeper API
details, recipes, and adapters in [site](https://v1000.reatom.dev) `/docs/start/*`, `/docs/handbook/*`, and `/docs/reference/*`.

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

## Core primitives and mental model

Reatom build on top of main single main primitive - "atom", that manage **immutable** state. Other primitives inherits atom:

- **computed**: lazy derived state with dependency tracking
- **effect**: computed that auto-subscribes for side effects
- **action**: callable event, also observable
- **extend**: attach capabilities, methods, or middleware

### Minimal core example

```ts
import { atom, computed, action, effect, wrap } from '@reatom/core'

// define simple changeable state
const list = atom<Item[]>([], 'list')
// put the atom name in the second argument for better debugging

// define action for imperative side effects or complex mappings
const fetchList = action(async (filters: { page: number }) => {
  return await wrap(api.getList(filters))
}, 'list.fetch')
// note how we chain relative atoms and actions names

// extend atom with actions or just methods
const page = atom(0, 'list.page').extend(
  (target /* <-- target is the extendable atom */) => ({
    reset() {
      // update atom with "set" method
      target.set(0)
    },
    prev() {
      // update atom with current state mapping with callback in "set"
      target.set((value) => Math.max(0, value - 1))
    },
    next() {
      target.set((value) => value + 1)
    },

    // assign other relative atoms if needed
    isPrevAvailable: computed(
      () => target() > 0,
      `${target.name}.isPrevAvailable`,
    ),
    isNextAvailable: computed(
      () => target() < list().length - 1,
      `${target.name}.isNextAvailable`,
    ),
  }),
)

// Run effect to fetch list when page changes
effect(() => {
  const filters = { page: page() }

  fetchList(filters)
}, 'list.effect')
```

The code bellow shows Reatom abilities - it simple and clean.

But this example has some bad practices:

- The page atom bind methods instead of actions. It is not critical, but recommended to use actions any data transformations and state updates.
  > Important: do not create "identity" actions that just forward data to atoms. Direct **atom.set** is preferred and still keeps nice logging and debugging via async context.
- Manual data fetching / getting / querying is **antipattern** in Reatom. It is much better for idempotent operations, even with async data, use `computed`.

```ts
const list = computed(async () => {
  const filters = { page: page() }
  return await wrap(api.getList(filters))
}, 'list')
```

It's cleaner and more efficient, as the computed subscribes and refetch the list only when have a subscription. But how to get the result state from the promise and track loading and error states? Reatom provides **withAsyncData** extension for this.

### extend example

```ts
import { atom, computed, withAsyncData, wrap } from '@reatom/core'

const page = atom(1, 'list.page')

const list = computed(async () => {
  const filters = { page: page() }
  return await wrap(api.getList(filters))
}, 'list').extend(withAsyncData({ initState: [] }))
```

Now we have extra atoms and actions to manage the list resource:

- **list.data()**: the fetched list data
- **list.ready()**: false by default and when the list is loading, true when the list is loaded
- **list.error()**: the error if the list fetching failed
- **list.status()**: union of loading / error / data states
- **list.retry()**: retry the list fetching
- **list.reset()**: reset the list fetch and data to the initial state
  > you can use `list.data.reset` separately to reset the data only

Also withAsyncData used `withAbort` under the hood, that prevent race conditions.

**Important**: computed + withAsyncData is the main recommended way to fetch data with Reatom.

> **Feature agent default**: when adding async read/query data for a feature, component, widget, page, or route-adjacent model, start with `computed(async () => ...)` extended by `withAsyncData()`. Do not begin with `effect`, `ref`, or imperative mount-time fetch code unless you have a specific reason. Use `action(...).extend(withAsync())` for mutations / commands instead.

`withAsyncData` accepts partial parameters:

- `initState` - undefined by default
- `mapPayload` - function to transform the payload into the data state, "identity" by default
- other options from `withAsync`

`withAsyncData` is superset of `withAsync` (+ `withAbort`), that used for async operations in general.

## withAsync

The base extension for async mutations and side effects.

Accepted options:

- `parseError` - function to transform the error into a specific error type
- `emptyError` - the initial error state
- `resetError` - when to reset the error state
- `status` - whether to enable the `status` atom (false by default for performance reasons)
- `cacheParams` - whether to enable caching of the last called parameters (false by default to prevent mem leaks), used by `retry` action

```ts
import { action, withAsync, wrap } from '@reatom/core'

const submit = action(async (payload: MyForm) => {
  const response = await wrap(
    fetch('/api/contact', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  )
  if (!response.ok) {
    throw new Error(`Failed to submit: ${response.statusText}`)
  }
}, 'myForm.submit').extend(withAsync())
```

Key points

- **submit.error()**, **submit.status()**, **submit.retry()** - the same base atom and actions
- **submit.ready()** true by default for withAsync
- **submit.onFulfill**, **submit.onReject**, **submit.onSettle** - additional actions for precise logging and tracking, that can be "hooked" with `withCallHook` for additional logic (available in `withAsyncData` too)
- **withAsync** does not add abort by default, add **withAbort** if needed

## **wrap** rules

**wrap** preserves async context for actions, effects, and atom updates. It is important to use wrap everywhere, even if it not necessary and can't brake something, it increase logs tracing and debugging capabilities. The same cause chain powers cancellation, process tracking, async transactions, and useful "why did this update happen?" logs.

Rules of thumb

- Use **wrap** on every async boundary that touches atoms or actions.
- Use **wrap** for promise results and callbacks after await or in then.
- Do not chain after **wrap**. Wrap each step.

Bad

- `await wrap(fetch(url)).then((res) => res.json())`
- `fetch(url).then((res) => !res.ok && error.set(res.statusText))`
- `addEventListener('click', () => doSome())`
- `withCallHook(wrap(() => doSome()))` - bad, do not wrap callbacks inside reatom methods and hooks

Good

- `await wrap(fetch(url).then((res) => res.json()))`
- `fetch(url).then(wrap((res) => !res.ok && error.set(res.statusText)))`
- `addEventListener('click', wrap(() => doSome()))`, or even better `onEvent(button, 'click', () => doSome())`
- `withCallHook(() => doSome())`

## Primitives quick usage

A nice helpers to manage typical data structures and values.

```ts
import { reatomBoolean, reatomEnum } from '@reatom/core'

// Atom with boolean state and handful actions
const isModalOpen = reatomBoolean(false, 'isModalOpen')
isModalOpen.setTrue()
isModalOpen.setFalse()
isModalOpen.toggle()

// Atom with powerful type inference, useful for replacing native enums
const priority = reatomEnum(['low', 'medium', 'high'], 'priority')
priority() // 'low' | 'medium' | 'high'
priority.enum // { low: 'low', medium: 'medium', high: 'high' }

// actions
priority.reset()
priority.setLow()
priority.setMedium()
priority.setHigh()
```

Notes

- **reatomBoolean** adds **setTrue**, **setFalse**, and **toggle** to keep updates semantic.
- **reatomEnum** is perfect for literal list union inference in TypeScript.

Good practice

- Always name **atoms**, **actions**, and **computed** values for tracing and logging.
- Use **action** for complex flows and side effects, **atom.set** for local updates.
- Avoid one-line actions that only forward data to atoms. Direct **atom.set** is
  preferred and still keeps a clear cause via async context.
- Prefer **computed** for derived values, **effect** for side effects.

Tricky parts

- **computed** is lazy: it recalculates only when it is connected.
- **effect** tracks dependencies and auto-clean on abort or unmount.

## Atomization

Atomization means: keep immutable structure as plain data, but lift mutable fields
into atoms.

Rule of thumb

- Mutable properties -> atoms.
- Readonly properties -> primitives.
- Backend DTOs stay plain at the boundary; application models atomize only the fields that the UI or workflow mutates.
- Do not atomize everything by default. Make reactivity explicit where it buys local updates, subscriptions, validation, or effects.

Simple example

```ts
import { atom, type Atom } from '@reatom/core'

type UserDto = { id: string; name: string }
type UserModel = { id: string; name: Atom<string> }

const user = atom<UserModel | null>(null, 'user').extend((target) => ({
  fromDto(dto: UserDto) {
    const name = atom(dto.name, `user.name`).extend(
      withChangeHook((name) => api.updateUserName(dto.id, name)),
    )
    return user.set({ id: dto.id, name })
  },
}))

// after fetch:
// user.fromDto(dto)
// later in UI or actions: user()?.name.set('New name')
```

Showcase: list updates without full array recreation

```ts
import { action, atom } from '@reatom/core'

const users = atom<Array<UserModel>>([], 'users').extend((target) => ({
  fromDto(dto: Array<UserDto>) {
    return target.set(
      dto.map((user) => ({
        id: user.id,
        name: atom(user.name, `users#${user.id}.name`),
        // note, we can "atomize" action too!
        remove: action(() => {
          target.set((state) => state.filter((u) => u.id !== user.id))
          api.deleteUser(user.id)
        }, `users#${user.id}.remove`),
      })),
    )
  },
}))
```

This pattern avoids O(n) immutable name changes for each field edit and keeps updates
focused on exactly the changed part. This data and actions modelling helps to archive the best part of OOP principles without the complexity of classes and so on.

The performance model is the main reason to prefer atomization for editable lists:
changing `users()[idx].name` is an O(1) field update instead of recreating a full
array and every intermediate object on each keystroke.

**Bad pattern**: normalize backend data, create separate additional list of elements states ("selected" / "checked" and so on).
**Good pattern**: atomize backend data, expand each element with additional atoms for local states ("selected" / "checked" and so on).

**Atomization is a main pattern with Reatom**, use it actively for dynamic editable structures, create factories for complex data structures and actions, nest and compose them for complex features.

Some naming tips:

- use "reatomSome" / "reatomOther" as a shortcut to "createSomeAtom" / "createOtherAction"
- duplicate the depth of the structure in the name, like "users.paging.current", use `#${ID}` pattern for dynamically created atoms and actions, like `goods.list#${id}.addToCart`.
- Put the parent name to the factory to support proper name nesting, like `reatomUser(userDto, 'users' + userDto.id)`

## Lifecycle and extension hooks

### **withConnectHook**

Runs a callback in "effect" phase when an atom gets its first subscriber, and auto-cleans on disconnect.

Use **withConnectHook** to lazy-start background work when data is actually needed.

Useful cases:

- Start polling only while a screen is mounted or data is subscribed.
- Attach and detach external listeners, websockets, or subscriptions.

Features:

- Run `effect` / `onEvent` inside, they will be aborted on disconnect
- Use `wrap` inside, it will be aborted on disconnect
- use `abortVar.subscribe(cb)` to subscribe for disconnect, or just return the cleanup callback
- `withDisconnectHook(cb)` is a shortcut to `withConnectHook(() => () => cb())`

Tricky:

- **withConnectHook** fires only on the first subscriber.

Example:

```ts
import { computed, withAsyncData, withConnectHook } from '@reatom/core'

const data = computed(async () => {
  /*  */
}, 'data').extend(
  withAsyncData(),
  // polling example
  withConnectHook(async (target) => {
    while (true) {
      await wrap(sleep(1000)) // will be aborted on disconnect
      target.retry()
    }
  }),
)
```

### **withChangeHook**

Runs a callback in "hooks" phase on every state change.

Good for stable cross-module wiring, not for dynamic factories.

Useful cases

- Synchronize the atom state to outer resource / consumer.

Tricky

- Do not use for atoms synchronization, use "computed" / "withComputed" instead
- Use **effect** with **ifChanged** for dynamic contexts.

### **withCallHook**

Runs a callback in "hooks" phase on every action call.

Same as **withChangeHook**, but for actions with good params and payload inference.

### **withInit** and **isInit**

Attach dynamic initial state after creation and detect init phase.

```ts
import { atom } from '@reatom/core'

// No need to use withInit for regular atoms, just put the state creation callback, instead of init state
const date = atom(() => new Date(), 'date')
```

```ts
import { reatomSet, withInit } from '@reatom/core'

// Use withInit to attach lazy initial state to an existing atom
const someSet = reatomSet(new Set<Some>(), 'someSet').extend(
  withInit((state) => {
    const snapshot = localStorage.getItem('someSet')
    return snapshot ? new Set(JSON.parse(snapshot)) : state
  }),
)
// btw, it is better to use withLocalStorage for the store sync
```

`isInit()` useful in computed or change hook.

### **withComputed**

Adds writable computed behavior to a changeable atom: it derives next state from
reactive reads, but still lets direct writes pass through the same state.

```ts
import { atom, withComputed } from '@reatom/core'

type Tab = { id: string }

const tabs = atom<Array<Tab>>([], 'tabs')
const currentTab = atom<Tab | null>(null, 'currentTab').extend(
  // focus on the last tab, when the atom initialized or the tabs list changed
  withComputed((state) => tabs().at(-1) ?? state),
)
```

```ts
import { atom, withComputed } from '@reatom/core'

const search = atom('', 'search')
const page = atom(1, 'page').extend(
  withComputed(() => {
    search() // do not use the search state, but drop the page state on search change
    return 1
  }),
)
```

## Event sampling and orchestration

Reatom treats actions as reactive events. Combined with `take`, `onEvent`, `race`, and `abortVar`, you write procedural async flows that read state, await events, and handle concurrency — with automatic abort and cleanup.

### **take**

Awaits the next atom update or action call inside an async action/effect. Resolves with the new value (atom) or payload (action).

- `await wrap(take(someAtom))` — next state change
- `await wrap(take(someAction))` — next call payload
- Second arg is a filter: resolves only when it returns truthy. `throwAbort()` inside the filter cancels the wait if the action is aborted.

```ts
if (!formIsValid()) {
  await wrap(take(formIsValid, (valid) => valid || throwAbort()))
}
await wrap(fetch('/api/submit', { method: 'POST' }))
```

### **onEvent**

Bridges DOM/external events into Reatom's abort-aware context. Listeners auto-clean on abort or disconnect. A better version of `addEventListener`!

- `onEvent(target, type, cb)` — subscribe, returns unsubscribe
- `onEvent(target, type)` — returns a promise, resolves on next event

```ts
const webhookPromise = onEvent(paymentEvents, 'payment.completed')
await wrap(fetch('/api/charge', { method: 'POST', body }))
const confirmation = await wrap(webhookPromise)
```

### **race** and **abortVar.createAndRun**

`abortVar.createAndRun(fn, ...args)` — runs `fn` and returns a `ControlledPromise` with an attached `AbortController`. `race(...controlledPromises)` — resolves with the first to settle, aborts all others with reason `"race"`. All code after `wrap` in losing functions never executes.

```ts
const a = abortVar.createAndRun(translateGoogle, text, lang)
const b = abortVar.createAndRun(translateDeepL, text, lang)
const result = await wrap(race(a, b))
```

### **withAbort** strategies

- `withAbort()` / `withAbort('last-in-win')` — default: aborts previous call when a new one starts (debounce-like)
- `withAbort('first-in-win')` — ignores new calls while previous is running (throttle-like)
- `withAbort('manual')` — no auto-abort; call `action.abort()` yourself (polling, long-running)
- `withAbort('finally')` — aborts all child operations when the action completes, including fire-and-forget ones

> **Debounce without debounce:** Reatom replaces traditional `debounce(fn, ms)` with a procedural pattern — put `await wrap(sleep(ms))` before the work inside an action with `withAbort()`. Each new call aborts the sleeping previous one, giving the same delay-then-execute behavior but with natural control flow: conditional delays, immediate value extraction, and full debuggability.

> **Note:** Abort errors (e.g. from route loaders on navigation away, or `withAbort` when cancelling) may appear as unhandled rejections in the console. This is not a bug in Reatom — it usually means an async/promise somewhere in the chain is not caught. Sometimes these can be safely ignored (e.g. aborted fetches when navigating away).

### **framePromise**

Returns a promise that resolves/rejects with the current action or atom frame's final result. Attach `.catch` / `.finally` at the top of the body instead of wrapping everything in try-catch.

```ts
const processOrder = action(async (orderId: string) => {
  framePromise().catch((error) => showErrorNotification(error))

  const order = await wrap(fetchOrder(orderId))
  await wrap(chargeCustomer(order))
  return order
}, 'processOrder')
```

### **ifChanged** and **getCalls**

Use inside **computed** or **effect** to react only to actual changes or new calls.

- `ifChanged(atom, cb)` — runs `cb` only when atom value changed since last run
- `getCalls(action)` — returns calls from the current batch (not a history store)

### Combined example

```ts
import {
  action,
  atom,
  effect,
  getCalls,
  ifChanged,
  onEvent,
  take,
  wrap,
} from '@reatom/core'

type CheckoutRequest = { orderId: string; requestedAt: number }

const checkoutRequested = action((orderId: string): CheckoutRequest => {
  return { orderId, requestedAt: Date.now() }
}, 'checkout.requested')
const confirmButton = atom<HTMLButtonElement | null>(null, 'confirmButton')
const lastOrderId = atom('', 'lastOrderId')

const checkoutFlow = action(async () => {
  const request = await wrap(take(checkoutRequested))
  const response = await wrap(fetch(`/api/orders/${request.orderId}/pay`))
  const payload: { receiptId: string } = await wrap(response.json())
  const element = confirmButton()
  if (element) {
    await wrap(onEvent(element, 'click'))
  }
  lastOrderId.set(payload.receiptId)
  return payload.receiptId
}, 'checkout.flow')

effect(() => {
  ifChanged(lastOrderId, (nextId) => {
    if (nextId) console.log({ lastOrderId: nextId })
  })
}, 'checkout.lastOrderId')

effect(() => {
  getCalls(checkoutRequested).forEach(({ payload }) => {
    console.log({ checkoutRequested: payload.orderId })
  })
}, 'checkout.requested.calls')
```

Tricky

- **take** and **onEvent** return promises — always `await wrap(...)` them inside async actions or effects.
- **getCalls** only returns calls in the current batch, it is not a history store.
- **ifChanged** only inside **effect** or **computed** with a few dependencies.
- **race** requires `ControlledPromise` from `abortVar.createAndRun`, not plain promises.

## Memoization: **memo** and **memoKey**

**memo** creates internal computed state inside a **computed** or **action**, scoped to the
host atom. **memoKey** stores arbitrary per-atom values by key.

```ts
import { computed, memo, memoKey } from '@reatom/core'

type Order = { total: number }
type ApiClient = { baseUrl: string }

const orders = computed((): Order[] => [], 'orders')

const stats = computed(() => {
  const items = orders()
  const total = memo(() => items.reduce((sum, item) => sum + item.total, 0))
  return { total }
}, 'orders.stats')

const client = computed(() => {
  return memoKey('client', (): ApiClient => ({ baseUrl: '/api' }))
}, 'api.client')
```

Tricky

- Use **memo** only inside **effect** or **computed** with a few dependencies.
- **memo** uses the first callback only. Use stable closures.
- Use a custom key when the same callback body is used multiple times.

## Forms: base usage and reactive validation

Forms are built from fields, field sets, and a **submit** action.

Key primitives

- **reatomField**: single field with state, value, focus, validation, disabled
- **reatomFieldSet**: grouped fields with aggregate focus and validation
- **reatomForm**: field set plus submit, schema validation, and form options

Use forms when React code starts accumulating field state, dirty flags, touched
flags, async validators, and submit errors across several hooks. Keep form
structure as objects and atoms instead of string paths. Reatom forms support
field-level and form-level validation, Standard Schema validators such as Zod or
Valibot, async validation, dynamic field arrays, focus state, dirty state, and
error state.

### Base form with schema and submit

```ts
import { reatomField, reatomForm, wrap } from '@reatom/core'
import { z } from 'zod/v4'

type AuthResult = { token: string }

const registerForm = reatomForm(
  {
    email: '',
    password: '',
    confirmPassword: reatomField('', {
      validate({ state }) {
        if (state.length > 0 && state === registerForm.fields.password()) {
          return undefined
        }
        return 'Passwords do not match'
      },
    }),
    handle: reatomField('', {
      async validate({ state }) {
        await wrap(sleep(300)) // debounce

        const response = await wrap(fetch(`/users/${state}`))

        if (response.status === 200) {
          return 'Handle already taken'
        }
        if (response.status === 404) {
          return undefined
        }
        return 'Error checking handle'
      },
    }),
  },
  {
    name: 'registerForm',
    validateOnBlur: true,
    schema: z.object({
      email: z.string().email(),
      password: z.string().min(8),
      confirmPassword: z.string().min(1),
    }),
    onSubmit: async (values): Promise<AuthResult> => {
      const response = await wrap(
        fetch('/api/register', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(values),
        }),
      )
      const payload: AuthResult = await wrap(response.json())
      return payload
    },
  },
)
```

Reactive validation note

- The validate callback tracks atoms it reads after the first trigger.
- This enables dependent validation without manual wiring.

Submit notes

- **submit** is async and expects errors to be thrown.
- **submit.error()** holds the latest error.
- **form.reset()** cancels submit and resets submitted state.

### React binding

```tsx
import { reatomComponent, bindField } from '@reatom/react'
import { registerForm } from './registerForm'

export const RegisterForm = reatomComponent(() => {
  const { fields, submit, validation } = registerForm
  const ready = submit.ready()
  const error = submit.error()

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <input type="email" {...bindField(fields.email)} />
      <input type="password" {...bindField(fields.password)} />
      <input type="password" {...bindField(fields.confirmPassword)} />
      <button type="submit" disabled={!ready}>
        Create account
      </button>
      {validation().errors.length > 0 && <div>Fix validation errors</div>}
      {error && <div>{error.message}</div>}
    </form>
  )
}, 'RegisterForm')
```

Tricky

- Validation errors for schema are distributed by path.
- Triggered state for field sets is true only when all fields were triggered.
- Use field arrays for dynamic lists instead of parallel arrays of values, errors, and touched flags.

## Routing

**reatomRoute** creates route atoms: reactive state that matches URL patterns, extracts typed params, loads data, and composes into layouts. Everything is auto-cancellable and reactive.

### Routes, nesting, search, validation

```ts
import { reatomRoute, urlAtom, wrap } from '@reatom/core'
import { z } from 'zod/v4'

// simple path — returns {} when matched, null when not
const homeRoute = reatomRoute('')
// path with params — returns { userId: string } or null
const userRoute = reatomRoute('users/:userId')
// optional param
const postRoute = reatomRoute('posts/:postId?')

// reading state
userRoute() // { userId: '123' } | null
userRoute.exact() // true only when URL is exactly /users/123
userRoute.match() // true when URL starts with /users/123

// navigation
userRoute.go({ userId: '123' }) // push to /users/123
userRoute.go({ userId: '123' }, true) // replace history entry
userRoute.path({ userId: '123' }) // build URL string without navigating
// urlAtom intercepts <a> clicks for SPA navigation by default, use .path() in href

// nested routes — chain .reatomRoute(), paths auto-compose, params inherit
const dashboardRoute = reatomRoute('dashboard')
const usersRoute = dashboardRoute.reatomRoute('users')
const userEditRoute = usersRoute.reatomRoute(':userId').reatomRoute('edit')
// userEditRoute.go({ userId: '123' }) → /dashboard/users/123/edit

// search params with zod — query string validation and transform
const goodsRoute = reatomRoute({
  path: 'goods/:category',
  search: z.object({ sort: z.enum(['asc', 'desc']).optional() }),
})
// goodsRoute.go({ category: 'tech', sort: 'asc' }) -> /goods/tech?sort=asc
// goodsRoute() -> { category: 'tech', sort: 'asc' }

// search-only routes (no path) preserve current pathname — great for global modals
const dialogRoute = reatomRoute({
  search: z.object({ dialog: z.enum(['login', 'signup']).optional() }),
})
// user at /profile/123 -> dialogRoute.go({ dialog: 'login' }) -> /profile/123?dialog=login
// nested search-only routes navigate to parent path if user is elsewhere

// params validation and transform with zod (or any Standard Schema)
const issueRoute = reatomRoute({
  path: 'issue/:issueId',
  params: z.object({ issueId: z.string().regex(/^\d+$/).transform(Number) }),
})
// issueRoute() returns { issueId: 123 } (number!) — if validation fails → null
```

### Loaders — auto data fetching

Route loaders are async computeds with `withAsyncData` built-in. They run when route matches, auto-abort on navigation away. Nested loaders await parents and receive merged params. Effects inside loaders also auto-abort on navigation.

Loader API (same as `withAsyncData`): **route.loader.data()**, **.ready()**, **.error()**, **.retry()**, **.status()**. Without explicit loader, `await wrap(route.loader())` returns validated params.

Prefer loaders for page data that belongs to route lifetime. A loader can create
route-scoped model factories; state created for that page is disconnected and
eligible for cleanup when navigation leaves the route. This solves the common
"global state cleanup" problem without manual unmount effects.

### Render and outlet — component composition

Routes define `render` for framework-agnostic component composition. `render(self)` receives the route: `self()` for params (non-null inside render), `self.loader` for the loader data.

Two kinds of routes:

- **Layout routes** (`layout: true`) — render on any match, use `self.outlet()` to wrap child content. Use for shells, sidebars, protection layers.
- **Page routes** (default) — render only on exact match. When a child is active, content bubbles up to the nearest layout's `outlet()`.

Typical app structure: root layout → optional auth/protection layers → page routes. Entire app renders from root: `computed(() => layoutRoute.render())`.

### Protected routes and modal gates

Protected routes use `params()` callback returning `null` to block the route and all descendants. Reactive: re-runs when read atoms change — use for auth, roles, feature flags, wizards.

Modal gate — route without URL path, `params(arg)` callback controls activation via `.go({ data })` / `.go()` (deactivate). State in memory, no URL pollution.

> **Antipattern**: manual `if (!route.match()) return null` checks in components. Use the `render` option instead — it handles mounting/unmounting and loader state automatically.

### urlAtom and global state

`urlAtom.go('/path')` navigates, `urlAtom()` reads `{ pathname, search, hash }`, `urlAtom.catchLinks(false)` disables SPA link interception, and `urlAtom.routes` is a registry of all created routes. `isSomeLoaderPending` tracks global loading state across all route loaders.

### Full SPA example

```ts
// setup.ts — import this file before others in the repo root!
import { connectLogger, log } from '@reatom/core'
if (import.meta.env.MODE === 'development') connectLogger()
globalThis.LOG = log
```

```ts
// routes.ts
import { computed, reatomRoute, withAsyncData, wrap } from '@reatom/core'
import { z } from 'zod/v4'

type User = { id: string; name: string; role: string }

export const layoutRoute = reatomRoute({
  layout: true,
  render({ outlet }) {
    return html`<div><header>My App</header><main>${outlet()}</main></div>`
  },
})

export const loginRoute = layoutRoute.reatomRoute({
  path: 'login',
  render() { return html`<form>Login Form</form>` },
})

const user = computed(async () => {
  const token = localStorage.getItem('token')
  if (!token) return null
  return await wrap(fetch('/api/me').then((r) => r.json()))
}, 'user').extend(withAsyncData())

export const protectedRoute = layoutRoute.reatomRoute({
  layout: true,
  params() {
    const userData = user.data()
    if (!userData) {
      if (user.ready() && !loginRoute.match()) loginRoute.go()
      return null
    }
    if (loginRoute.match()) dashboardRoute.go()
    return userData
  },
  render(self) { return self.outlet() },
})

export const dashboardRoute = protectedRoute.reatomRoute({
  path: 'dashboard',
  render() { return html`<h1>Dashboard</h1>` },
})

export const usersRoute = protectedRoute.reatomRoute({
  path: 'users',
  search: z.object({
    q: z.string().optional(),
    page: z.string().regex(/^\d+$/).transform(Number).default('1'),
  }),
  async loader({ q, page }) {
    const response = await wrap(fetch(`/api/users?q=${encodeURIComponent(q ?? '')}&page=${page}`))
    return await wrap(response.json())
  },
  render(self) {
    const { isPending, data } = self.status()
    if (isPending) return html`<div>Loading users...</div>`
    return html`<section><h1>Users</h1><ul>${data.items.map(
      (u: User) => html`<li><a href="${userRoute.path({ userId: u.id })}">${u.name}</a></li>`
    )}</ul></section>`
  },
})

export const userRoute = usersRoute.reatomRoute({
  path: ':userId',
  params: z.object({ userId: z.string().regex(/^\d+$/) }),
  async loader({ userId }) {
    return (await wrap(fetch(`/api/users/${userId}`).then(r => r.json()))) as User
  },
  render(self) {
    const { isFirstPending, data, error } = self.status()
    if (isFirstPending) return html`<div>Loading user...</div>`
    if (error) return html`<div>Error: ${error.message}</div>`
    return html`<section><h2>${data.name}</h2><div>${data.role}</div></section>`
  },
})

export const confirmModal = protectedRoute.reatomRoute({
  params({ message }: { message?: string }) {
    return message ? { message } : null
  },
  render(self) {
    return html`<dialog open>${self().message}</dialog>`
  },
})
// confirmModal.go({ message: 'Sure?' }) opens, confirmModal.go() closes.

// App.ts
const App = computed(() => html`${layoutRoute.render()}`)
```

## URL sync and persistence helpers

### **withSearchParams** for list filters

```ts
import { atom, withSearchParams } from '@reatom/core'

const query = atom('', 'catalog.query').extend(withSearchParams('q'))
const page = atom(1, 'catalog.page').extend(
  withSearchParams('page', {
    parse: (value) => Number(value ?? '1'),
    serialize: (value) => (value === 1 ? undefined : String(value)),
  }),
)
const sort = atom<'popular' | 'new' | 'price'>('popular', 'catalog.sort').extend(
  withSearchParams('sort', (value) =>
    value === 'new' || value === 'price' ? value : 'popular',
  ),
)
```

### **withLocalStorage** for preferences

```ts
import { atom, withLocalStorage } from '@reatom/core'

const theme = atom<'light' | 'dark'>('light', 'theme').extend(withLocalStorage('theme'))
```

Persistence notes:

- Use storage adapters instead of custom `useEffect` read/write loops.
- Available adapters include localStorage, sessionStorage, IndexedDB, BroadcastChannel, Cookie, Cookie Store, and in-memory storage.
- Prefer schema validation for persisted payloads and add migrations when the format changes.
- Use TTL when stale persisted data should expire.
- Use memory fallback when browser storage may be unavailable.

## Suspense notes

Use suspense for global initialization, not for dynamic page data.

- **withSuspense** adds **.suspended()** that throws promise for Suspense.
- **withSuspenseInit** turns async init atoms into sync after init.
- **withSuspenseRetry** retries actions that touch suspended atoms.
- Use **preserve** to keep previous data during refresh.
- Avoid non-idempotent side effects inside **withSuspenseRetry**.

## Transactions notes

Transactions support optimistic updates with rollback.

- **withRollback** on atoms tracks state changes.
- **withTransaction** on actions triggers rollback on errors.
- **action.rollback()** rolls back only the last call of that action.
- **action.stop()** commits the last call and clears rollback queue.
- Abort does not trigger rollback.

```ts
import { action, atom, withAsync, withRollback, withTransaction, wrap } from '@reatom/core'

type Todo = { id: string; title: string }

const todos = atom<Todo[]>([], 'todos').extend(withRollback())

const saveTodo = action(async (todo: Todo) => {
  todos.set((items) => [...items, todo])
  const response = await wrap(fetch('/api/todos', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(todo),
  }))
  return (await wrap(response.json())) as Todo
}, 'todos.save').extend(withAsync(), withTransaction())
```

## SSR and testing

- **context.start** creates isolated contexts for SSR requests or tests.
- **clearStack** forces explicit **wrap** usage, useful for strict isolation, not recommended by default.
- **context.reset** clears the default global context between tests run (if you not using clearStack).

## v3 migration highlights

- Implicit context is default in v1000, **ctx** is not used.
- **ctx.schedule**(promise) -> **wrap**(promise)
- **ctx.spy**(atom) -> **atom**()
- **ctx.get**(atom) -> **peek**(atom)
- **atom**(callback) -> **computed**(callback)
- **atom**(ctx, value) -> **atom.set**(value)
- **ctx.spy**(atom, cb) -> **ifChanged**(atom, cb)
- **ctx.spy**(action, cb) -> **getCalls**(action).forEach(cb)
- **reatomAsync**(cb) -> **action**(cb).extend(**withAsync**())
- **reatomResource**(cb) -> **computed**(cb).extend(**withAsyncData**())
- **reaction** -> **effect**
- **atom.onChange**(cb) -> **atom.extend**(**withChangeHook**(cb))
- **onConnect**(atom, cb) -> **atom.extend**(**withConnectHook**(cb))
- **withConcurrency** -> **withAbort**
- **onCtxAbort** -> **abortVar.subscribe**

## Other APIs (not detailed here)

This list is intentionally brief. See the full docs for additional features,
recipes, adapters, and edge cases: https://v1000.reatom.dev/reference/TOPIC_NAME

Core: **addGlobalExtension**, **withActions**, **withMiddleware**, **withParams**, **bind**, **context**, **clearStack**, **mock**, **anonymizeNames**, **isAtom**, **isAction**, **isComputed**, **isConnected**, **named**

Extensions: **withAbort**, **withMemo**, **withDynamicSubscription**, **withSuspense**, **withSuspenseRetry**, **addChangeHook**, **addCallHook**, **withDisconnectHook**

Methods: **abortVar**, **variable**, **peek**, **schedule**, **retry**, **deatomize**, **reatomLens**, **reatomObservable**, **framePromise**, **getStackTrace**, **isCausedBy**, **retryComputed**. Computed values without dependencies are not reevaluated without `retryComputed`.

Routing extras: **searchParamsAtom**, **withSearchParams**, **urlAtom** hooks, link interception config, hash routing, **is404**, **isSomeLoaderPending**

Primitives: **reatomArray**, **reatomBoolean**, **reatomEnum**, **reatomNumber**, **reatomString**, **reatomMap**, **reatomSet**, **reatomRecord**, **reatomLinkedList**

Persistence: **reatomPersist**, **withLocalStorage**, **withSessionStorage**, **withIndexedDb**, **withBroadcastChannel**, **withCookie**, **withCookieStore**, **createMemStorage**

Web: **onLineAtom**, **reatomMediaQuery**, **reatomWebSocket**, **rAF**, **fetch** wrapper

Utils: equality helpers, abort errors, timers, and typed helpers.
