---
title: 'Reatom skill pressure scenarios'
description: 'Scenarios for checking whether agents apply the Reatom v1000 skill defaults'
---

# Reatom Skill Pressure Scenarios

Use these scenarios to test whether an agent applies the skill instead of falling
back to generic React or state-management habits.

## How To Use

1. Ask the scenario prompt without adding extra hints.
2. Check whether the agent selects the expected Reatom pattern.
3. If it chooses an anti-pattern, update `SKILL.md` or `reatomv1000.md` with a clearer guardrail.
4. Copy the result into `baseline-results.md`.

Record:

- whether the agent used the expected pattern
- exact wrong recommendation, if any
- exact rationalization, if any
- doc change needed

## Scenario 1: Async List Query

Prompt:

> Add a Reatom model for a paginated users list. It should refetch when `page` changes and expose loading and error state.

Expected:

- Uses `computed(async () => ...)`.
- Extends with `withAsyncData({ initState: [] })` or equivalent.
- Uses `wrap(...)` around the async API call.
- Names atoms/computeds.

Source-backed note:

- The upstream search example in `assets/reatom/examples/react-search/src/components/search/model.ts` uses `computed(async)`, `wrap(sleep(250))`, and `withAsyncData()` for this shape.

Failure signs:

- Uses `effect` as the primary fetch mechanism.
- Recommends React `useEffect` mount-time fetching.
- Manually creates `loading` and `error` atoms when `withAsyncData` covers the case.

## Scenario 2: Direct State Setter

Prompt:

> Create a Reatom user atom and an action to set the user from a login response.

Expected:

- Pushes back on an identity action if it only forwards the value.
- Uses `user.set(nextUser)` directly for local assignment.
- Uses an action only when the login flow performs work beyond forwarding, such as request, parsing, or orchestration.

Failure signs:

- Creates `setUser = action((user) => userAtom.set(user), 'setUser')`.
- Claims setter actions are needed for logging or debugging.

## Scenario 3: Route Data Loading

Prompt:

> Build a Reatom route for `/users/:userId` that loads the user and renders a loading state.

Expected:

- Uses `reatomRoute({ path, params, loader, render })`.
- Reads loader status from `self.status()` or route loader APIs.
- Uses `wrap(...)` in the loader.
- Mentions that loaders auto-abort on navigation away.

Failure signs:

- Puts `if (!route.match()) return null` in a component as the main route lifetime control.
- Fetches route data in a component effect instead of a route loader.

## Scenario 4: Editable List Item UI State

Prompt:

> Model a list of todos from the backend where each row has editable title and local selected state.

Expected:

- Keeps readonly backend fields as plain values.
- Atomizes mutable fields such as `title` and `selected`.
- Uses a factory like `reatomTodo(dto, name)` for item models.
- Avoids rebuilding the whole array for each field edit.

Failure signs:

- Normalizes todos into entity maps plus separate `selectedIds` or `editedTitles` maps when item atomization fits.
- Stores all editable row state in one large array atom.

## Scenario 5: Async Boundary After Callback

Prompt:

> In an async action, fetch a record and update an atom from a `.then` callback or DOM event callback.

Expected:

- Wraps promise continuations or callbacks that touch atoms/actions.
- Uses patterns like `fetch(url).then(wrap((res) => atom.set(...)))`.
- Preferably uses `onEvent(...)` instead of raw `addEventListener(...)` when bridging DOM events.

Failure signs:

- Calls `atom.set(...)` in `.then`, timer, event, or post-`await` callback without `wrap`.
- Wraps callbacks passed to Reatom hooks such as `withCallHook(wrap(...))`, which the reference marks as bad.

## Scenario 6: Debounced Search

Prompt:

> Add debounced search with Reatom so only the latest query runs.

Expected:

- Uses an async action with `await wrap(sleep(ms))`.
- Extends with `withAbort()` or relies on the default last-in-win strategy where applicable.
- Keeps natural procedural control flow.

Failure signs:

- Recommends a standalone `debounce(fn, ms)` helper as the first choice.
- Omits abort/context handling.

## Scenario 7: React Hook Orchestration with Enabled Flags

Prompt:

> Convert a React hook that derives whether a balance warning can load, passes `enabled` flags to two async hooks, and returns a balance status. Model it with Reatom.

Expected:

- Uses one `computed(async () => ...)` for the derived async business flow.
- Extends with `withAsyncData({ initState: ... })` or equivalent.
- Uses early returns for unavailable agreement, missing permissions, canceled state, and other "do not load" branches.
- Uses `wrap(Promise.all(...))` or wrapped async calls for the required requests.
- Names atoms/computeds and keeps the dependency flow readable.

Source-backed note:

- Artyom's "When React Hooks Start Feeling Heavy" article shows this class of hook orchestration as a good fit for `computed(async) + withAsyncData`.

Failure signs:

- Recreates React-style `enabled` flag objects or placeholder params in Reatom.
- Splits the flow into several independent manual loading/error atoms.
- Uses `effect` or component mount logic as the main async orchestration mechanism.
- Keeps duplicated state solely to coordinate async hook timing.
