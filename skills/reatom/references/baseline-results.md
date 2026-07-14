---
title: 'Reatom skill baseline results'
description: 'Observed failures and rationalizations from pressure testing the Reatom v1000 skill'
---

# Reatom Skill Baseline Results

Iteration 1 ran on 2026-05-03 with `claude-sonnet-4-6` as executor.
Workspace: `C:\Users\Khmil\.agents\skills\reatom-workspace\iteration-1\`

## Summary

| Config | Pass rate | Avg tokens | Avg time |
| --- | --- | --- | --- |
| with_skill | **1.0** (26/26) | 40 231 | 69.8 s |
| without_skill | **0.40** (10/26) | 23 147 | 59.3 s |
| delta | **+0.60** | +17 084 | +10.5 s |

## Results Table

| Scenario | Without skill | With skill | Doc change needed |
| --- | --- | --- | --- |
| Async List Query | 0.25 (1/4) | 1.0 (4/4) | Add eval assertion for `computed+withAsyncData` vs `reatomAsync+onConnect` in editable-list-items eval |
| Direct State Setter | 0.33 (1/3) | 1.0 (3/3) | None |
| Route Data Loading | 0.25 (1/4) | 1.0 (4/4) | None |
| Editable List Item UI State | 1.0 (4/4) | 1.0 (4/4) | Add assertion checking fetch mechanism (non-discriminating eval) |
| Async Boundary After Callback | 0.33 (1/3) | 1.0 (3/3) | None |
| Debounced Search | 0.67 (2/3) | 1.0 (3/3) | Tighten assertion 2: also exclude setTimeout/clearTimeout debounce |
| React Hook Orchestration with Enabled Flags | 0.0 (0/5) | 1.0 (5/5) | None — highest-impact scenario |

## Scenario Detail

### Scenario 1: Async List Query

Without skill:
- Pattern chosen: `reatomAsync` + `onUpdate` to trigger refetch
- Exact wrong recommendation: Used `reatomAsync(async (ctx, page) => ...)` instead of `computed(async)`
- Exact rationalization: "Using `reatomAsync` + `onUpdate` — the reactive pattern"

With skill:
- Pattern chosen: `computed(async) + withAsyncData + wrap` — correct
- Remaining issue: None

Doc change needed: None (skill already handles this correctly)

---

### Scenario 2: Direct State Setter

Without skill:
- Pattern chosen: Separate setter actions (`setUserFromLogin`, `clearUser`)
- Exact wrong recommendation: `setUserFromLogin = action((ctx, response) => { userAtom(ctx, user) })` + `clearUser = action((ctx) => userAtom(ctx, null))`
- Exact rationalization: Framed as "good design" for composability

With skill:
- Pattern chosen: `user.set(data)` inside login action, no identity setters
- Remaining issue: None

Doc change needed: None

---

### Scenario 3: Route Data Loading

Without skill:
- Pattern chosen: `reatomAsync` + `userIdAtom` + `useEffect` + `onChange`
- Exact wrong recommendation: Synced route param via `useEffect` into `userIdAtom`, triggered fetch via `userIdAtom.onChange`
- Exact rationalization: "Standard Reatom data-fetching approach"

With skill:
- Pattern chosen: `reatomRoute({ path, async loader, render })` with `wrap` in loader
- Remaining issue: None

Doc change needed: None

---

### Scenario 4: Editable List Item UI State

Without skill:
- Pattern chosen: Per-item factory `createTodoAtom(dto)` with atomized fields — **correct on atomization**
- Exact wrong part: Used `reatomAsync + onConnect + onFulfill.onCall` for fetch instead of `computed(async) + withAsyncData + mapPayload`
- Note: The without-skill agent independently reached for item atomization; the assertions didn't capture the fetch-mechanism difference

With skill:
- Pattern chosen: `reatomTodo(dto, parentName)` factory + `computed(async) + withAsyncData({ mapPayload })` — fully correct
- Remaining issue: **Eval is non-discriminating** — add assertion for fetch pattern

Doc change needed: Add assertion to `evals/evals.json` eval 4: "Uses `computed(async) + withAsyncData` with a `mapPayload` callback for the list fetch (not `reatomAsync + onConnect`)."

---

### Scenario 5: Async Boundary After Callback

Without skill:
- Pattern chosen: Closed-over `ctx` called directly in `.then()` without `wrap`
- Exact wrong recommendation: `fetch(url).then((data) => { recordAtom(ctx, data); isLoadingAtom(ctx, false) })` — no `wrap`
- Exact rationalization: "ctx is closed over — safe to use inside `.then()`"

With skill:
- Pattern chosen: `fetch(url).then(wrap((res) => res.json())).then(wrap((data) => atom.set(data)))` and `addEventListener('click', wrap(...))` / `onEvent`
- Remaining issue: None

Doc change needed: None

---

### Scenario 6: Debounced Search

Without skill:
- Pattern chosen: External `let debounceTimer: ReturnType<typeof setTimeout>` with `setTimeout`/`clearTimeout`
- Exact wrong recommendation: Manages debounce entirely outside Reatom with a module-level timer
- Exact rationalization: "Standard debounce approach" (technically works but non-idiomatic for Reatom)
- Note: Does use `withAbort()` on the fetch — cancellation is partially correct

With skill:
- Pattern chosen: `await wrap(sleep(DEBOUNCE_MS))` + `withAbort()` inside async action
- Remaining issue: Assertion 2 needs tightening to also exclude `setTimeout` debounce

Doc change needed: Tighten assertion 2 in `evals/evals.json` eval 6.

---

### Scenario 7: React Hook Orchestration with Enabled Flags

Without skill:
- Pattern chosen: 3 separate `reatomAsync` + `canLoadAtom` + `balanceWarningOrchestrator` + `balanceWarningStatusAtom`
- Exact wrong recommendation: Recreated the React `enabled` flag pattern as `canLoadAtom` gating each fetch
- Exact rationalization: "Mirrors the hook's enabled flag coordination in Reatom"

With skill:
- Pattern chosen: Single `computed(async)` with early returns + `withAsyncData` — eliminates all coordination overhead
- Remaining issue: None

Doc change needed: None — highest-value scenario confirmed

## Rationalizations Observed

- "ctx is closed over — safe to use inside `.then()`" ← async-boundary eval, without-skill
- "Using reatomAsync + onUpdate — the reactive pattern" ← async-list-query eval, without-skill
- "Mirrors the hook's enabled flag coordination in Reatom" ← react-hook-orchestration eval, without-skill
- "Standard debounce approach" ← debounced-search eval, without-skill

## Rationalizations To Watch

- "Setter actions are better for logging."
- "A React `useEffect` fetch is simpler."
- "Manual loading/error atoms are more explicit."
- "Route matching in components is easier to understand."
- "Normalized maps are always the scalable option."
- "Wrapping is unnecessary after the first await."
- "React-style enabled flags are the clearest way to coordinate conditional async work."

---

# Iteration 2

Iteration 2 ran on 2026-05-03 with `claude-sonnet-4-6` as executor.
Workspace: `C:\Users\Khmil\.agents\skills\reatom-workspace\iteration-2\`

Skill changes from iteration 1:
- Added lazy subscription guidance to `llm.md` (before/after code example)
- Added lazy subscription checklist item to `SKILL.md`
- Eval 1: added 5th assertion for lazy atom reads after early-return guards
- Eval 4: added 5th assertion for `computed+withAsyncData+mapPayload` vs `reatomAsync+onConnect`
- Eval 6: tightened assertion 2 to also exclude `setTimeout`/`clearTimeout` debounce

## Summary

| Config | Pass rate | Avg tokens | Avg time |
| --- | --- | --- | --- |
| with_skill | **1.0** (35/35) | 37 519 | 56.0 s |
| without_skill | **0.32** (11/35) | 23 375 | 69.4 s |
| delta | **+0.68** | +14 144 | −13.4 s |

Compared to iteration 1: without_skill dropped from 0.40 → 0.32 because the three new/tightened assertions specifically target the failure patterns baseline agents fall back to.

## Results Table

| Scenario | Without skill iter 1 | Without skill iter 2 | Change | With skill |
| --- | --- | --- | --- | --- |
| Async List Query | 0.25 (1/4) | 0.20 (1/5) | −0.05 | 1.0 |
| Direct State Setter | 0.33 (1/3) | 0.33 (1/3) | 0 | 1.0 |
| Route Data Loading | 0.25 (1/4) | 0.25 (1/4) | 0 | 1.0 |
| Editable List Item UI State | 1.00 (4/4) | 0.80 (4/5) | −0.20 | 1.0 |
| Async Boundary After Callback | 0.33 (1/3) | 0.33 (1/3) | 0 | 1.0 |
| Debounced Search | 0.67 (2/3) | 0.33 (1/3) | −0.33 | 1.0 |
| React Hook Orchestration | 0.00 (0/5) | 0.00 (0/5) | 0 | 1.0 |

## Scenario Detail

### Scenario 1: Async List Query (new assertion)

New assertion: "In the component, atoms whose values are only needed in non-error/non-loading branches are read after the early-return guards (lazy subscription), not eagerly before them."

Without skill:
- Reads all atoms unconditionally at the top of the component via `useAtom(errorAtom)`, `useAtom(readyAtom)`, `useAtom(dataAtom)` before any guards
- Cannot lazy-subscribe because React hook rules require hooks at the top level; agent doesn't know about `reatomComponent`
- Passes 1/5 (same existing assertion as before; new assertion fails)

With skill:
- Reads `error()` first, returns early; then reads `ready()`, returns early; then reads `data()` — correct lazy order
- Passes 5/5

---

### Scenario 4: Editable List Item UI State (new assertion)

New assertion: "Uses `computed(async) + withAsyncData` with a `mapPayload` callback for the list fetch (not `reatomAsync + onConnect`)."

Without skill:
- Still correctly implements per-item atomization factory — passes 4 existing assertions
- Uses `reatomAsync + withDataAtom` (v3 API) for the list fetch instead of `computed(async) + withAsyncData + mapPayload`
- Scores 4/5; eval is now discriminating

With skill:
- Uses `computed(async ctx => { const raw = await wrap(fetch(...).then(r => wrap(r.json()))); return raw }).extend(withAsyncData({ mapPayload: ... }))` — correct
- Passes 5/5

---

### Scenario 6: Debounced Search (tightened assertion)

Tightened assertion 2: now requires the **positive** condition `await wrap(sleep(ms))`, not merely absence of `setTimeout`/`clearTimeout`.

Without skill:
- Previously passed assertion 2 because it avoided `setTimeout`/`clearTimeout` (used `ctx.schedule(fn, ms)` — a v3 API)
- Now fails assertion 2: `ctx.schedule` is not `await wrap(sleep(ms))` and explicitly fails the positive check
- Scores 1/3 (down from 2/3)

With skill:
- Uses `await wrap(sleep(DEBOUNCE_MS))` inside async action + `withAbort()`
- Passes 3/3

---

### Scenario 7: React Hook Orchestration (no change, still highest-impact)

Without skill:
- Uses 4 separate `reatomAsync` actions: `fetchPermissionsAction`, `fetchAgreementAction`, `fetchBalanceAction`, `fetchWarningLevelAction`
- Creates `canLoadAtom` — explicit boolean gate checked inside each action body
- Creates separate `isLoadingAtom` that OR's `isPending` from two actions
- Uses `withStatusesAtom` (v3 API) on each action
- Scores 0/5 — every assertion fails

With skill:
- Single `computed(async)` named `balanceWarning` encompassing all conditional logic
- Early returns: `if (!perms?.hasPermission) return null`, `if (isUnavailable) return null`
- No `enabled` objects or placeholder params
- `.extend(withAsyncData<... | null>({ initState: null }))` for `.ready()`, `.error()`, `.data()`
- Passes 5/5

## New Rationalizations Observed (iteration 2)

- "Using `ctx.schedule(fn, ms)` for debounce — schedules the fetch after a delay" ← debounced-search, without-skill (v3 API fallback)
- "Uses 4 `reatomAsync` actions (v3 API) with `canLoadAtom` enabled gate" ← react-hook-orchestration, without-skill (enabled-flag anti-pattern)
- "Uses `withStatusesAtom` for loading/error state" ← react-hook-orchestration, without-skill (v3 API fallback)
