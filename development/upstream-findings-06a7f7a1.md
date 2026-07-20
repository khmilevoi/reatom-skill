# Upstream findings: `af2f81f4` → `06a7f7a1`

**Status: landed 2026-07-20.** This began as a proposal document; the outcome of each item
is now recorded in "What was landed" below. Parts 0–3 are applied unless marked deferred.

Vendored pin: `reatom/reatom@af2f81f4` (branch `v1001`, synced 2026-07-14).
Clone HEAD at investigation time: `06a7f7a1`, 54 commits ahead.
Investigated: 2026-07-20.

Every item below carries **what to change**, **why it earns its place**, and **source of
truth**. Paths without a prefix are relative to the plugin repo; paths under
`development/upstream/reatom/` are the clone and are abbreviated as `clone/`.

## Verification status — read this before acting

Findings came from seven independent read-only agents plus one workflow that adversarially
verified each of its own findings against two lenses (factual citation check, redundancy
check). Coverage is uneven and you should treat it that way:

- **Verified twice or more** — anything marked ✔✔ below was found independently by more
  than one agent, or found by one and re-verified by me directly in the clone.
- **Verified once** — marked ✔.
- **Unverified** — marked ⚠. The workflow's verification fan-out lost 16 agents to a
  session limit, and its synthesis step never ran. Findings from `core-tests`,
  `conventions`, and part of `eslint-surface` were proposed but never adversarially
  checked. Do not land a ⚠ item without re-reading its cited source.

Six of 45 workflow findings were refuted outright; I could not recover *which* six from the
journal, so a ⚠ item may be one of them.

---

## Part 0 — Mandatory: re-sync the vendored handbook ✔✔

**Change.** Run `node development/sync-upstream.js`.

**Why.** The skill is currently serving guidance upstream has superseded. Of the four
vendored sources only `skills/reatom-jsx/REFERENCE.md` changed (+14/-3), and one of those
edits reverses a recommendation:

```diff
 if (import.meta.hot) {
-  import.meta.hot.accept(() => {
+  import.meta.hot.dispose(() => {
     unmount()
   })
+  import.meta.hot.accept()
 }
```

The order matters semantically — `dispose` tears the old route down *before* the new one
registers. We ship the old shape today. Two further additions: the Vite config snippet now
includes the `reatom()` plugin, and a new Limitations paragraph documents that lifecycle
tracking is scoped to the `mount` target, so detaching an *ancestor* of the mount node
leaks every live subscription.

**Source of truth.** `clone/skills/reatom-jsx/REFERENCE.md:36-52`, `:117-135`, `:957`;
commits `0094534a`, `dfca155e`. Byte-verified: our vendored body is identical to the
`af2f81f4` blob and differs from HEAD; the other three vendored sources have zero diff in
this range.

**Non-issue, checked.** Commit `7d06fc66` ("rm client skills config") deleted only
`skills-lock.json`. All four paths the sync script declares still exist at HEAD — the
script will not break.

---

## Part 1 — Corrections to existing rules

These come first deliberately. Each one is a rule that currently fires on correct code, or
states something factually wrong. A missed violation costs one violation; a false positive
costs trust in the audit, and an audit nobody trusts gets uninstalled. Every item here is
cheaper to land than a new rule and worth more.

### 1.1 RTM-L02 / RTM-L01 — `effect` is not categorically forbidden ✔✔✔

**The single most important finding in this pass.** Three agents converged on it
independently, and I verified it directly.

**What is wrong.** RTM-L02 has `trigger: effect(` and `exception: none`. RTM-L01's
exception line asserts `effect()` "self-subscribes and never disconnects". That claim is
false for any `effect` inside an abortable scope, and upstream documents the forbidden
shape as its own recommendation.

**Source of truth.**
- Mechanism: `clone/packages/core/src/methods/effect.ts:92` — `effect` is
  `.extend(withAbort(), withDynamicSubscription())`; `withDynamicSubscription.ts:6-7`
  documents "performs unsubscribe automatically, when abort will occur".
- `effect.ts:51-54` (JSDoc) — "Calling this function is usually not necessary when `effect`
  is used within managed contexts like `reatomFactoryComponent` or `withConnectHook`, as
  cleanup happens automatically."
- Upstream-documented instances of the shape we forbid:
  `clone/docs/src/content/docs/handbook/computed-factory.md:193-198`
  (`while (true) { await wrap(sleep(30_000)); fetchStats() }` inside `effect`, with
  `:214` explaining `withAbort()` on the outer computed is what makes it safe);
  `clone/docs/src/content/docs/handbook/forms/recipes/auto-submit.md:39-58`
  (`withFormAutoSubmit`, a recommended reusable extension built on `effect`);
  `clone/packages/core/src/web/rAF.ts:15-35` (core's own JSDoc prescribes `effect` for rAF).
- Real-world density: ~15 `effect` uses across the jsx examples, and the gallery example
  contains **zero** `withConnectHook` — commit `3d142494` deliberately removed the only one.

**What stays forbidden.** The nuance the rule gets right: `effect.ts:95` does
unconditionally self-subscribe, so a bare module-level `effect` owning a resource genuinely
never stops. `clone/examples/reatom-jsx-winamp/src/audioGraph.ts:13` + `:114` is exactly
that — a module-level `let audioGraph` plus an `effect`, with an `AudioContext` that is
never disposed.

**Proposed replacement:**

```markdown
### RTM-L02 — Do not reintroduce lifetime with a top-level effect
- domain: lifecycle
- kind: anti-pattern
- bad: a module-level `effect(() => { const id = setInterval(...) })` owning a timer with no abortable parent
- good: `withConnectHook` returning a cleanup, or an `effect` created inside an abortable scope — a `computed` factory extended with `withAbort()`, a route `loader`, `withConnectHook`, or `reatomFactoryComponent`
- detect: `effect` owning a long-lived resource at module scope, where no enclosing scope can abort it
- trigger: effect(
- exception: an `effect` created inside a managed/abortable scope — `withDynamicSubscription` unsubscribes it on abort, and upstream documents this for polling loops and `withFormAutoSubmit`; also an `effect` whose returned `unsubscribe` is explicitly owned by a connect hook or adapter ref callback
- ref: upstream/core.md#Lifecycle and extension hooks
```

And RTM-L01's exception line, currently factually wrong, becomes:

```markdown
- exception: none at module scope — a bare top-level `effect()` self-subscribes and nothing aborts it; inside an abortable parent, `effect` is a sanctioned alternative
```

**Knock-on.** RTM-L01 should stop naming one hook as *the* owner and name the principle
instead: an effect must have a lifetime owner that returns cleanup. Legitimate owners
observed upstream: `withConnectHook`, `withDisconnectHook`, `reatomObservable`, an adapter
`ref` callback, and an abortable enclosing scope.

**Registry-internal contradiction this exposes.** RTM-A05 prescribes debounce via
`await wrap(sleep(ms))` "inside an async action extended with `withAbort()`". Upstream's own
debounce of a *derived* value lives in an `effect` instead
(`clone/examples/reatom-jsx-gallery/src/models/lightboxDisplayTarget.ts:136-145`), because
the trigger is an atom change, not a user gesture, and `effect` re-invalidation cancels the
previous frame without needing `withAbort`. RTM-A05's `good` line is too narrow.

### 1.2 RTM-C01 — the prescribed remedy is illegal for `useAtom` ✔

**What is wrong.** RTM-C01 tells the auditor to move atom reads *below* early-return
guards, and lists `useAtom` among its triggers. But `@reatom/react`'s `useAtom` is a real
React hook: it calls `React.useMemo` and `useSyncExternalStore` unconditionally. Moving it
after an early return violates the Rules of Hooks. Our rule, followed literally on a
`useAtom` file, instructs the user to write broken code.

**Source of truth.** `clone/packages/react/src/hooks.ts:62` (`React.useMemo`), `:112`
(`useSyncExternalStore`) — both unconditional inside `useAtom`.

**Fix.** Scope the rule to `reatomComponent` (where reads are plain calls and reordering is
safe) and add an explicit exception for `useAtom`/`useAction` and any genuine hook.

**Premise re-verified, holds.** `reatomComponent` still exists under that name
(`clone/packages/react/src/reatomComponent.ts:88`, mirrored in `packages/preact`), and
dependency registration happens per atom call, so a read before an early return does
subscribe. The rule's rationale is sound; only its remedy over-reaches.

### 1.3 RTM-S05 — `exception: none` is wrong, and the naming shape is misstated ✔

**Source of truth.** `clone/packages/eslint-plugin/src/rules/unit-naming-rule.ts` — this is
our RTM-S05 as executable code with tests.

Three separate corrections:

1. **Exception exists.** The linter reports nothing when the unit call has no enclosing
   `VariableDeclarator`/`Property` with a plain `Identifier` id — `unit-naming-rule.ts:59-64`
   pushes `null`, and `:119-120` returns early. Upstream's own linter permits unnamed units
   in those positions; our `exception: none` is stricter than upstream.
2. **The `${modelName}.field` shape is not upstream's canonical form.** Upstream enforces
   the *value*, in four layers: the final segment must equal the enclosing identifier
   verbatim (`:246-249`); the domain prefix must match the enclosing scope, resolved from
   factory params or from `node.id.name.replace('reatom','')` (`:126-128`, `:68-89`); an
   object segment; and a `local` insert. Canonical outputs are enumerable at `:310-317`.
3. **Names can live in a config object.** `resolveNameNode` accepts the 2nd positional arg
   or a `name` property when there is a *single* object argument (`:99-115`). Most v1001
   `reatom*` factories take `(initState, options)` with `name` inside `options` — our
   `detect` ("created without a name argument") reads positional-only and misses this.

**Also.** Upstream's unit set is `/^(reatom\w+|atom|action|reaction)$/` — the whole
`reatom*` family, which our trigger list does not cover. Two caveats before copying it:
`reaction` does **not** exist at HEAD (`grep` for its export returns nothing — it is stale
in upstream's own `shared.ts`), so do not add a trigger that can never legitimately fire;
and `effect(` is missing from RTM-S05's triggers, so unnamed `effect`s are invisible today.

**Do not treat the linter as a spec.** See §4.2 — its `wrap-rule` is inoperative, and the
naming rule false-positives on the 2-arg options form. Cite it for *intent*, verify
behavior against tests.

### 1.4 RTM-A04 — one exception documented, six exist ✔

**Source of truth.** `clone/packages/eslint-plugin/src/rules/wrap-rule.test.ts` valid cases:
`:26-32`, `:36-42`, `:44-51`, `:53-60`, `:94-102` (already-wrapped shapes); `:74-84`
(outside any Reatom unit); `:86-93` (plain async function); `:104-111`
(`await wrap(Promise.all([...]))`).

Additions needed:

- Already-wrapped boundaries, and code not lexically inside a Reatom unit.
- **Adapter hooks that already wrap** — `useAction`/`useWrap` return callbacks bound to the
  component frame: `clone/packages/react/src/hooks.ts:142`,
  `clone/packages/react/src/reatomComponent.ts:60-71`. Our current exception says "callbacks
  passed to Reatom's own hooks", which is ambiguous between core extension hooks and adapter
  hooks. An auditor can reasonably flag correct code today.
- **`bind()` for externally-invoked callbacks.** ✔ The word `bind` appears in neither
  `rules.md` nor any vendored file, yet it is the correct primitive when a callback is
  invoked later from outside (`ResizeObserver`, `IntersectionObserver`, worker `message`).
  Commit `d2d1a473` deliberately replaced `context.start(...)` with `bind(...)`:
  `clone/examples/reatom-jsx-gallery/src/models/gridLayout.ts:29-30`; primitive at
  `clone/packages/core/src/core/atom.ts:1509`. Division: `wrap` for continuations after
  `await`; `bind` for callbacks invoked later from outside.

**Three wrap anti-patterns our registry never encodes** ⚠ — already in our own vendored
`references/upstream/async.md:137,139,141` (heading `## wrap Rules`) but absent from
`rules.md`: (a) do not chain after `wrap` — `await wrap(fetch(url)).then(...)`; (b)
`wrap(() => atom.set(...))` as a bare statement is a no-op because `wrap(fn)` returns a
function; (c) the third listed at `:141`. These are misuse of a *present* wrap, which our
missing-wrap detection cannot see.

### 1.5 False positives confirmed on upstream's own code

Each verified against a real upstream file. All are exception-line edits.

| Rule | Fires on | Source of truth | Verdict |
| --- | --- | --- | --- |
| RTM-R02 | `new URLSearchParams({q, page})` building an **outbound** API request | `clone/examples/react-search/src/api/github.ts:37-41` | ✔ Add exception: URL/URLSearchParams not describing the app's own location |
| RTM-R03 | `new BroadcastChannel('x')` constructed **to pass into** `withBroadcastChannel`, and `typeof localStorage !== 'undefined'` feature detection | `clone/examples/react-persist-web/src/app.tsx:14-17`, `:28-30`, `:44-61` | ✔ Add both exceptions; the extension's signature *requires* constructing the channel |
| RTM-L01 | `addEventListener` inside a `reatomObservable` `subscribe` descriptor that returns cleanup — textbook-correct code | `clone/examples/reatom-jsx-gallery/src/models/viewport.ts:43-47`, `:74`, `:83`, `gridLayout.ts:40-50` | ✔ Add exception; `viewport.ts` alone would produce a wall of noise |
| RTM-L01 | `.subscribe` handed to `useSyncExternalStore` (a framework binding, not a lifetime leak) | `clone/examples/form/src/index.tsx:87`, `use-form-field.tsx:48-49` | ✔ Add exception — misrouting this to L01 sends the user to the wrong fix |
| RTM-A03 | `computed(() => !x.ready())` and `export const err = x.error` — reading the extension, not maintaining a manual atom | `clone/examples/react-search/src/components/search/model.ts:51-55` | ✔ Add exception (note: current case-sensitive triggers happen to miss `isIssuesLoading`, so the gate stays quiet — but an auditor reading the rule by intent will flag it) |
| RTM-A05 | `setTimeout` whose callback touches no Reatom unit | `clone/examples/reatom-jsx-winamp/src/windowControls.ts:327`; `clone/examples/reatom-jsx-gallery/src/yieldToBrowser.ts:7` | ✔ Add exception |
| RTM-S04 | Two **named actions** composed in one handler — the rule's `bad` is two raw `.set()` calls | `clone/examples/reatom-jsx-winamp/src/components/Visualizer.tsx:200-203` | ✔ Sharpen `detect` to "two or more raw `.set()`" |

### 1.6 Trigger-token gaps ✔

Cheap, mechanical, no semantic change.

- **RTM-R03** — add `indexedDB, withIndexedDb`. Manual IndexedDB use is undetectable today.
  Upstream uses it as a reusable alias: `clone/examples/reatom-jsx-winamp/src/model.ts:23-24`,
  applied to 7 atoms; API at `clone/packages/core/src/persist/web-storage/indexedDb.ts:319`.
- **RTM-S05** — add `effect(`. Unnamed `effect`s are currently invisible
  (`clone/examples/tweakpane/src/MonitorDemo.tsx:21,39,61,85`).
- **RTM-L01** — add `withInitHook`. `clone/examples/reatom-jsx-xo/src/time.ts:3-10` starts a
  never-stopping ticker via `withInitHook` and matches no trigger.
- **RTM-S04 / RTM-R04** — add `on:click` / `on:submit` (Reatom's own JSX renderer,
  `clone/packages/jsx/src/index.ts:531`, `:379`), and consider `@click` (Vue/Lit). Neither
  contains the substring `onClick`/`onSubmit` under case-sensitive `String.includes`.
- **RTM-S01** — `detect` catches only `action(...)` bodies that forward an argument. A plain
  exported one-line function wrapper slips through, and `SKILL.md`'s "Do Not Recommend"
  already forbids it: `clone/examples/reatom-jsx-gallery/src/models/previewLoad.ts:134-136`,
  `models/lightboxDisplayTarget.ts:161-163`.

---

## Part 2 — New rules

IDs are allocated here to resolve collisions: three agents independently proposed `RTM-A07`
for three different rules, two proposed `RTM-R05`, two proposed `RTM-L03`, and one proposed
the prefix `RTM-N`, which `consistency.test.js` rejects outright (the prefix letter must
match the domain: A/S/L/R/C).

Ranked by whether they change a decision a user actually makes.

### 2.1 RTM-A07 — Read reactive inputs before the first `await` ✔ (strongest new rule)

```markdown
### RTM-A07 — Read reactive inputs before the first await
- domain: async
- kind: anti-pattern
- bad: `computed(async () => { const file = await wrap(load()); const size = target(); … })`
- good: capture `const size = target()` synchronously at the top, then `await wrap(load())`
- detect: an atom read after an `await` inside `computed(async)` that is meant to be a dependency
- trigger: computed(async, await wrap
- exception: reads that intentionally must not retrigger — use `peek(...)` to make that explicit
- ref: upstream/async.md#wrap Rules
```

**Why.** Dependency tracking covers only reads before the first `await`. A read placed after
one never becomes a dependency — and nothing fails. The symptom is a value that stops
updating after mount, with no error. This is framework-agnostic and applies to every
`computed(async)`.

**Source of truth.** `clone/examples/reatom-jsx-gallery/src/reatomImage.ts:268-277` — the
upstream authors wrote the warning themselves, in a comment, after being bitten:
"Dependency tracking only covers reads before the first await, so every reactive input must
be captured synchronously here." It also explains the `peek(...)` calls at `:256-261`,
`:313`, `:325` as deliberate opt-outs. Confirmed absent from `async.md`, `core.md`,
`review.md`, and `rules.md`.

### 2.2 RTM-S07 — Derived collections are computed, with a keyed model cache ✔

```markdown
### RTM-S07 — Derived collections are computed over the source, with a keyed model cache
- domain: state
- kind: anti-pattern
- bad: `reatomLinkedList(...).extend(withConnectHook(() => { a.subscribe(sync); b.subscribe(sync) }))` mirroring loaded data
- good: `computed(() => source().map(getModel), 'items')` plus a `Map` by id so each entity keeps one model instance
- detect: a collection primitive kept in sync by `subscribe`/`effect` fan-out, or a model factory called without an identity cache
- trigger: reatomLinkedList, .subscribe(, createMany, clear()
- exception: the collection is the source of truth and is mutated directly — then `reatomLinkedList` is correct
- ref: atomization-notes.md#Collections of models
```

**Why.** RTM-S03 covers atomizing a *row* and says nothing about how a *collection* of
models is created, keyed, or reused. Without this, the user mirrors server data into a
mutable list primitive and syncs it with a `subscribe` fan-out — which upstream itself
wrote and then deleted.

**Source of truth.** Commit `3d142494` removed exactly that shape from
`clone/examples/reatom-jsx-gallery/src/models/collection.ts` (a `reatomLinkedList` +
`effect` + four manual `.subscribe()` calls + `batch(clear + createMany)`) and replaced it
with one `computed` plus a `Map` identity cache: `collection.ts:22-36`, `:71-92`, `:140-151`.
A refactor commit that moves *away from* a shape is the strongest signal available.

**The boundary, which keeps the rule honest.** `reatom-jsx-tree` uses `reatomLinkedList`
correctly (`clone/examples/reatom-jsx-tree/src/model.ts:30-35`) because there the list *is*
the source of truth and the user mutates it directly. Owned collection → `reatomLinkedList`;
derived collection → `computed` + keyed cache.

**Blocker.** `ref` points at `atomization-notes.md#Collections of models`, which **does not
exist**. That section must be written first or the ref test fails.

### 2.3 RTM-C02 — Wrap React event handlers that touch Reatom ✔✔

```markdown
### RTM-C02 — Wrap React event handlers that touch Reatom
- domain: react
- kind: anti-pattern
- bad: `onClick={() => model.save()}` inside a reatomComponent
- good: `onClick={wrap(() => model.save())}`, or `{...bindField(field)}` for form inputs
- detect: a JSX event prop whose handler reads or writes an atom/action without `wrap`
- trigger: onClick, onChange, onSubmit, onBlur, reatomComponent
- exception: handlers from `useAction`/`useWrap`/`bindField` (already wrapped), and handlers that never touch Reatom
- ref: golden-example.md
```

**Why.** Without `wrap`, the handler runs outside the component frame: it loses causal
tracing, writes to the global root, and — the part that actually bites — **is not aborted on
unmount**, so an async handler can still write into an unmounted component. Under
`clearStack()`, which the skill itself recommends, it becomes a hard
`ReatomError: missing async stack`.

**Source of truth.** Documented, not merely observed: `clone/packages/react/README.md:79` —
"Event handlers should be wrapped with `wrap()` … to preserve the reactive context"; `:81`
covers the abort-on-unmount half. I verified this line directly. Density: 18 call sites
across three examples (`react-search` `SearchBar.tsx:20,32,43`, `FilterPanel.tsx:33,49,57,66,73`,
`Pagination.tsx:36-39,46`, `IssueCard.tsx:13-15`, `IssuePage.tsx:41,54,66`). Shown in our
`golden-example.md:101,117,121,126` but never made a rule.

### 2.4 RTM-L03 — Each SSR request runs inside its own `context.start()` ✔

```markdown
### RTM-L03 — Each SSR request runs inside its own context.start()
- domain: lifecycle
- kind: anti-pattern
- bad: a server handler that renders or reads atoms without entering a frame, so all requests share the module-level root
- good: `context.start(async () => { setupSsrUrl(href); await wrap(preload()); return snapshot })` per request
- detect: server-side render, loader, or route handler touching atoms outside `context.start`
- trigger: renderToString, renderToPipeableStream, createFileRoute, defineEventHandler, getServerSideProps, context.start
- exception: browser-only entry points
- ref: upstream/core.md#SSR and testing
```

**Why.** This is the only finding in the whole pass that silently leaks *one user's data to
another*. Without a per-request frame the server writes into `STACK[0]`, a root that lives
for the entire Node process; an atom filled by request A is read by request B. No error, and
SPA tests never show it.

**Source of truth.** `clone/packages/core/src/core/atom.ts:1395-1435` — every `context.start`
creates a fresh `store: new WeakMap()`; `:1557` — `STACK.push(context.start())` creates the
shared module-level root at import. Usage: `clone/examples/tanstack-start-ssr/src/lib/reatom-ssr.ts:88-101`,
`__root.tsx:19-22,31,55`. Corroborated outside the example at
`clone/packages/core/src/extensions/withCache.test.ts:420`.

**Note.** `SKILL.md:27` already advertises SSR coverage while `rules.md` has no SSR rule.
`upstream/core.md:1022` gives it three bullets.

### 2.5 RTM-R05 — Disable `urlAtom` sync before setting it on the server ✔

```markdown
### RTM-R05 — Disable urlAtom sync before setting it on the server
- domain: routing-forms
- kind: anti-pattern
- bad: `urlAtom.set(new URL(req.url))` on the server with the default sync in place
- good: `urlAtom.sync.set(() => noop); urlAtom.set(new URL(href))`
- detect: `urlAtom.set`/`urlAtom.go` reachable from server code without a preceding `urlAtom.sync.set`
- trigger: urlAtom, urlAtom.sync, urlAtom.set
- exception: browser-only code paths
- ref: upstream/core.md#SSR and testing
```

**Why.** The default `urlAtom.sync` calls `history.pushState`. On the server any URL-backed
state (`withSearchParams`, `reatomRoute`) throws `ReferenceError: history is not defined`
**inside a `setTimeout`** — an unhandled timer exception, not a render-stack error. Nearly
undiagnosable, and it is a two-line fix.

**Source of truth.** `clone/packages/core/src/web/url.ts:175-186` (default sync →
`history.pushState`), `:126-131` (init warns "window is undefined, you should setup urlAtom
manually"). The exact two-line sequence appears in two independent places:
`clone/examples/tanstack-start-ssr/src/lib/reatom-ssr.ts:29-32` and
`clone/packages/core/src/extensions/withCache.test.ts:381-384`.

### 2.6 RTM-R06 — Combining `withSearchParams` and `withLocalStorage` ✔

```markdown
### RTM-R06 — Combine withSearchParams and withLocalStorage deliberately
- domain: routing-forms
- kind: anti-pattern
- bad: `atom(0.7, 'volume').extend(withSearchParams('volume'), withLocalStorage('volume'))` assuming a shared URL wins
- good: apply `withLocalStorage` first, then `withSearchParams`, and connect the atom before relying on URL sync
- detect: an atom carrying both a storage extension and `withSearchParams`, or URL-shareable state read before connection
- trigger: withSearchParams, withLocalStorage, withSessionStorage
- exception: none
- ref: upstream/core.md#URL sync and persistence helpers
```

**Why.** A user who follows R02 and R03 separately, each correctly, gets behavior opposite to
what they expect: **localStorage wins over a shared URL on cold start**. "I sent you a link
and you saw your own old state" is a bug report nobody traces back to extension order.

**Source of truth.** `clone/packages/core/src/persist/web-storage/persistSearchParams.test.browser.ts`
(added by `947be299`) — test "saved preference wins over a shared URL on cold start":
`urlAtom.go('/?volume=0.90')` with `0.42` stored yields `0.42`. Cause:
`clone/packages/core/src/routing/searchParams.ts:241-247` — URL sync lives in middleware
bound to the atom's frame and does not run until the atom is connected. A third test shows
two-way sync only starts after `subscribe()`.

### 2.7 RTM-A08 — Cache async reads with `withCache` ✔

```markdown
### RTM-A08 — Cache async reads with withCache, not a hand-rolled map
- domain: async
- kind: reinvention
- bad: `const cache = new Map(); const get = async (id) => cache.get(id) ?? cache.set(id, await api.item(id))`
- good: `computed(async () => wrap(api.item(id())), 'item').extend(withAsyncData(), withCache({ staleTime: 60_000, swr: true }))`
- detect: a module-level `Map`/object memo, manual TTL via `Date.now()`, or a hand-written stale-while-revalidate loop around an async atom
- trigger: new Map(), Date.now(), staleTime, cache
- exception: caching unrelated to an atom/action result
- ref: upstream/async.md#Cache Order
```

**Why.** `withCache` ships LRU (`length`, default 5), TTL (`staleTime`, default 5 min),
stale-while-revalidate, keying by params, and persistence passthrough. `rules.md` never
mentions it — zero hits for `withCache`, `cacheAtom`, `swr`, `staleTime`. Today we only
catch the *ordering* mistake, i.e. the case where the user already knows the API exists.
This is precisely the `reinvention` class RTM-A01/A03 target.

**Source of truth.** `clone/packages/core/src/extensions/index.ts:2` (public export);
`withCache.ts:83` (`length`), `:97` (`staleTime`), `:105-122` (`swr`), `:134`/`:143`
(`paramsToKey`/`isEqual`), `:125-127` (`withPersist`), `:420-458` (invalidate/set/delete).

**Ordering does not need its own rule** ✔ — it throws loudly at construction time:
`clone/packages/core/src/async/withAsync.ts:218-222` raises `ReatomError("can not attach
withAsync after withCache, you need to reorder them")`. A loud failure needs documentation,
not an auditor. Our `async.md:393-408` already covers it.

### 2.8 Thinner candidates — propose, but rank last

Honest assessment: each rests on a narrower base than the above.

- **RTM-L04 — third-party instance owned by an atom.** ✔ Recurs across three examples
  (`clone/examples/tweakpane/src/reatomInstance.ts:34-51` and ~15 uses;
  `tweakpane/core.ts:38-46`). Real pattern, but the helper is **example-local, not a
  `@reatom/core` export** — verified by grep. Any rule must teach the *shape*
  (`computed` + `abortVar.subscribe(dispose)` + `withAbort` + `withDisconnectHook`) and must
  not cite an API that does not exist.
- **RTM-L05 — two-way widget binding without re-entrancy flags.** ✔ The concrete guard is
  `Object.is` deduplication in `withChangeHook`
  (`clone/packages/core/src/extensions/withChangeHook.ts:30`, `:90`) and `atom.set`
  (`atom.ts:732`). Worth noting: `ifChanged` is used **zero** times across all five examples,
  contrary to the hypothesis. The real trap is the inverse — a library mutating an object
  in place keeps identity, so the update is *silently dropped*; upstream's fix is
  `target.set({ ...value })` (`tweakpane/bindings.ts:66-70`).
- **Instrumentation via middleware** ⚠ — `withMiddleware`/`withActionMiddleware` are real
  (`clone/packages/core/src/core/extend.ts:204`, `action.ts:87`, whose own JSDoc example at
  `extend.ts:176-189` is a logger) and absent from the skill. But framing it as an
  anti-pattern rule ("no `console.log` in action bodies") is a stretch; a reference section
  is the better home.

---

## Part 3 — Reference additions (no rule)

These are real gaps that no trigger token can detect. Rules would be false-positive
machines; prose is correct here.

1. **`references/atomization-notes.md#Collections of models`** — required by RTM-S07 (§2.2).
   Owned vs derived collections, identity caching, and why rebuilding models per render
   destroys per-item async cache.
2. **`references/atomization-notes.md` — connection lifetime owns the async cache.** ✔
   Unmounting a row disconnects its atoms, and `withAsyncData` drops the data; filtering by
   conditional render silently re-fetches everything on return. Upstream's fix was to stop
   unmounting and hide with CSS instead (`clone/examples/reatom-jsx-gallery/src/components/ImageGrid.tsx:27`,
   commit `3d142494`); rationale comment at `reatomImage.ts:280-283`. The mechanism is
   framework-agnostic; only the fix is DOM-specific.
3. **`references/react-guide.md` — SSR section.** ✔ Per-request frame, `urlAtom` setup, and
   cache handoff via `createMemStorage` + `reatomPersist` + `withCache({ withPersist })`
   (`clone/examples/tanstack-start-ssr/src/model.ts:32-33,39-48`;
   `lib/reatom-ssr.ts:99,106-111`). **State one caveat honestly:** there is no public
   "await all async state" API — the example patches `root.pushQueue` (`reatom-ssr.ts:49-78`),
   copied verbatim from a core test. `allSettled` is not exported from
   `clone/packages/core/src/index.ts`. Present it as "copy this helper", not as an API.
4. **`references/react-guide.md` — `wrap` / `bind` / `onEvent` decision table.** ✔ See §1.4.
5. **`references/react-guide.md` — `reatomFactoryComponent`.** ⚠ Component-scoped models,
   used in all five tweakpane demos (`clone/packages/react/src/reatomComponent.ts:152-179`).
   Neither the guide nor RTM-C01 mentions it.
6. **`references/react-guide.md` — provider and `clearStack()`.** ✔ Optional for a plain SPA;
   **required** after `clearStack()` and for SSR. Upstream's own examples disagree with each
   other here (`react-persist-web/src/index.tsx:1,7,11` uses both;
   `react-search/src/main.tsx:8-9` uses neither), so state it explicitly rather than
   inferring. Do not make it a rule — it would fire on `react-search`.
7. **`references/react-guide.md` — do not copy JSX atom placement into React.** ✔ Upstream's
   JSX examples create atoms **in the component body**
   (`clone/examples/reatom-jsx-tree/src/App.tsx:19,52-53`), which is correct there (the
   component runs once) and **fatal in React** (recreated every render). Our audience is
   React-centric and these examples are the most visible ones — this needs saying out loud.
8. **Sharpen RTM-R04's prose** ✔ — name Standard Schema (`@standard-schema/spec` is
   `@reatom/core`'s only runtime dependency), show `bindField`, and add the fourth primitive
   the rule omits: `reatomFieldArray` (`clone/packages/core/src/form/index.ts:1-5`). Schema
   issues route to fields by `path` (`reatomForm.ts:586`, `:327-344`).
9. **Testing entry point** ⚠ — `@reatom/core/test` appears nowhere in the skill. Commit
   `444f8202` made it wrap all vitest modifiers (`clone/packages/core/src/test.ts:21-71,90`).
10. **`@reatom/vite` in `SKILL.md` Default Decisions.** ✔ `SKILL.md:28` advertises
    "Vite/Reatom SPA structure", yet the skill contains zero occurrences of `vite`, `HMR`, or
    `hot module`. The plugin injects HMR cleanup for `reatomRoute` and `mount()`
    (`clone/packages/vite/src/plugin.ts:55`, `transform.ts:151-172`; dev-only, and it bails
    out if the module already has `import.meta.hot`). Configuration, not a code pattern — no
    rule, since `vite.config.ts` belongs to no auditor domain.

---

## Part 4 — Deliberately excluded

Recording these matters as much as the additions: each is a plausible-looking item that
would have been wrong to land.

### 4.1 `@reatom/zod` is not a forms/validation package ✔

My own subagent brief assumed it was, and the workflow refuted the premise. `reatomZod`
converts a Zod schema into a **tree of atoms** (JSON → reactive model) and is never used with
`reatomForm`/`reatomField` anywhere upstream. Exports: `silentUpdate`, `EXTENSIONS`,
`getDefaultState`, `reatomZod`. Form validation is Standard Schema; Zod is one interchangeable
implementation of that interface.
**Source:** `clone/packages/zod/src/index.ts:294-309`, `:187-193`, `:196`; `README.md:1`.
This is a gap that must *not* be filled — RTM-R04 is correct to say nothing about it.

### 4.2 Do not treat upstream's ESLint plugin as an executable spec ✔

The strongest single reason the whole "mine the linter" line of inquiry did not become a
rule source. `wrap-rule`'s Reatom-context gate cannot return true for the nodes it guards:
`isReatomContext` succeeds only on `parent.arguments[0] === node`, comparing the *reported*
node (the `AwaitExpression` at `:156`, the `setTimeout` CallExpression at `:182`).
**Source:** `clone/packages/eslint-plugin/src/rules/wrap-rule.ts:38-70` (esp. `:48`), `:156`,
`:182`. Corroborating rot: the README documents an `async-rule` that `src/index.ts:6-9` does
not register and describes `ctx.schedule` (a v3 API); the naming rule's message at `:292`
interpolates the wrong variable; the comma heuristic at `:144` tests the whole file's text.
Cite the plugin for *intent*; verify behavior against its tests. Do not recommend installing
it — ⚠ I could not execute its suite (unresolved workspace bin links), so the "inoperative"
conclusion is a static reading with three corroborations, not an observed run.

### 4.3 `subscribe(cb, errorCb)` does not compete with `.error()` ✔

Genuinely new (`clone/packages/core/src/core/atom.ts:134-137`, `action.ts:28-31`, commit
`3c482b13`), and the name invites misuse. But `@reatom/react` binds `subscribe` **without**
`errorCb` (`clone/packages/react/src/hooks.ts:90`); the only consumer is jsx's
`ErrorBoundary`. It is a renderer-level primitive, not a replacement for `withAsyncData`'s
`.error()`. One agent proposed a rule against it; I am rejecting that as premature — it would
police an API almost no application author will touch. Worth one line in "Do Not Recommend"
at most.

### 4.4 Others

- **`instance` helper** (`d6ae696e`, `clone/packages/core/src/utils.ts:605-611`) — a DOM
  type-narrowing assert for JSX refs. Supersedes nothing. Re-sync only.
- **jsx `ErrorBoundary`** — real and well-tested, but jsx-only, **undocumented even
  upstream** (grep across all four vendored files and upstream's own `skills/` and `docs/`:
  zero hits), and `@reatom/react` has no equivalent. A re-sync will *not* close this gap;
  flag it as hand-maintained if added.
- **Gallery perf commits** (`476f46e5`, `d2d1a473`) — application constant tuning
  (`DEFAULT_MAX_SIZE` 800→300, concurrency factor). Only the `context.start` → `bind` swap
  generalizes (§1.4). Dropped as predicted.
- **The `form` example** — must not be used as a source. **I verified this myself:**
  `examples/form/src/index.tsx:1` imports from `"../src"`, which resolves to itself; there is
  no `packages/form` in the repo; `index.html:11` loads a nonexistent `/sandbox/index.tsx`;
  it uses `experimental_fieldArray` and the `@deprecated ArrayFieldItem`. Its 76-line
  `use-form-field.tsx` hand-rolls what `bindField` does in one spread. Its *only* salvageable
  content is the `reatomForm` call shape at `index.tsx:17-53`.
- **`a717e029` (jsx untracked reads)** — two `peek()` calls; removes a perf trap rather than
  creating a usage rule. Undetectable in user code.
- **Internal refactors** — `ecba4645` (frame retrieval), `e08eab89` (flushRollbacks),
  `8ce9a556` (`toStringKey`/`isDeepEqual` — verified to have no consumers outside its own
  test), `10e8025e` (`addErrorHook` unsubscribe identity). No public signature changed.
- **`904abe0d`** — test-only regression lock on existing RTM-R01 behavior.

---

## Part 5 — Infrastructure findings

Not skill content, but they gate the work above.

1. **The gate only ever sees `.ts`/`.tsx`.** ✔ `hooks/gate-logic.js:7` filters to those
   extensions, so `.vue` SFCs and `.svelte` files are never audited.
   **Correction to this finding:** it originally claimed `SKILL.md` promises adapter *audit*
   coverage. It does not. That line sits under "When To Inspect `node_modules`" and is about
   when to read an adapter's source while answering — not about what the gate scans. The
   README describes the audit accurately as firing on "changed TypeScript". No false promise
   exists, so nothing was changed here; widening the filter remains an open option, not a
   fix for a broken claim.
   The React-leaning trigger tokens are *not* a blind spot either — `gate-logic.js:94-103`
   unions triggers per **domain**, so a React-only token blinds an auditor only if it is that
   domain's sole token, and none is.
2. **ID allocation is now contended.** Resolved above as: `RTM-A07` (pre-await reads),
   `RTM-A08` (`withCache`), `RTM-S07` (derived collections), `RTM-L03` (SSR frame),
   `RTM-L04`/`RTM-L05` (instances, two-way binding), `RTM-R05` (`urlAtom` on server),
   `RTM-R06` (searchParams + storage), `RTM-C02` (wrap handlers). Note `RTM-N` is invalid —
   `consistency.test.js:78-91` requires the prefix letter to match the domain.
3. **Most proposed `ref:` anchors do not exist yet.** `consistency.test.js:204-221` resolves
   every `- ref: file#anchor` against real headings. Verified as **existing**:
   `upstream/core.md#SSR and testing` (`:1022`), `#Lifecycle and extension hooks` (`:312`),
   `#URL sync and persistence helpers` (`:937`), `#**withChangeHook**` (`:355`),
   `#Forms: base usage and reactive validation` (`:590`), `#Atomization` (`:244`),
   `upstream/async.md#Cache Order` (`:391`), `#wrap Rules` (`:116`). Verified as **missing**:
   `atomization-notes.md#Collections of models` — must be authored before RTM-S07 lands.
   `atomization-notes.md` currently has only two sections; `react-guide.md` only three.
4. **Landing order.** Re-sync (Part 0) → rewrite `rules.md` → `npm run build-slices` (slices
   are generated and byte-compared) → add the `references/` sections the new refs point at →
   tag every new id in `SKILL.md` (`consistency.test.js:189-200` requires exact parity) →
   `npm test`.

---

## Recommended sequencing

**Land first — corrections.** Part 0 re-sync, then §1.1 (RTM-L02/L01), §1.2 (RTM-C01),
§1.5 (false positives), §1.6 (triggers). These remove wrong behavior from a shipping audit
and need no new prose.

**Land second — the two rules that prevent silent data bugs.** §2.4 (SSR frame — cross-request
leakage) and §2.1 (pre-`await` reads — silently dead dependencies). Both fail without any
error message, which is what makes them worth encoding.

**Land third.** §2.3, §2.5, §2.6, §2.7, then §2.2 once its reference section exists.

**Reconsider later.** §2.8 and everything in Part 3 that is marked ⚠.

---

## What was landed

Applied on 2026-07-20. `npm test` goes from 55 to 56 tests, all passing.

**Vendored.** Re-synced to `06a7f7a1`. Only `jsx.md` changed content (+17 lines); the other
three moved their banner sha only.

**Rules corrected** — RTM-L02 rewritten around "who can abort this" rather than "does this
use `effect`"; RTM-L01's false claim about `effect` replaced and its exceptions widened
(`reatomObservable`, framework bindings) plus `withInitHook` added to triggers; RTM-C01
scoped to `reatomComponent` with an explicit Rules-of-Hooks carve-out for `useAtom`;
RTM-A04 given the five missing exceptions and `bind`; RTM-A03, RTM-A05, RTM-A06, RTM-R02,
RTM-R03, RTM-S01, RTM-S02, RTM-S04, RTM-S05 given the exceptions and triggers listed in
Part 1; RTM-R04 extended with `reatomFieldArray`, `bindField` and `on:submit`.

**Rules added** — RTM-A07, RTM-A08, RTM-S07, RTM-L03, RTM-R05, RTM-R06, RTM-C02. Seven new
ids, collisions resolved as described in Part 5.2.

**References added** — `atomization-notes.md#Collections of models` and
`#Connection lifetime owns the async cache`; `react-guide.md#Event handlers and Reatom
context`, `#Choosing between wrap, bind and onEvent`, `#SSR: per-request frame and cache
handoff`, `#Provider and clearStack`, `#Do not copy atom placement from the JSX examples`.
`SKILL.md` updated throughout: Default Decisions, Quick Reference, Do Not Recommend,
Validation Checklist, Reference Map.

**Auditor briefs.** All five had stale rule-id ranges in their bodies, and
`audit-lifecycle` still taught the corrected-away claim that `effect` "never disconnects".
Bodies and `description:` frontmatter updated for every new rule.

**New test.** `consistency.test.js` gained a check that an auditor's body cites only its own
domain's rules and states its full range. The existing test covered frontmatter only, which
is why the body drift went unnoticed. Verified by mutation: reverting `audit-async` to
`RTM-A01…RTM-A06` fails with "audit-async announces RTM-A06, but async now ends at
RTM-A08".

**Calibration corpus.** Added `violations/late-await-read.ts` (RTM-A07) and a second clean
control, `clean/sanctioned-shapes.ts`, built entirely from shapes that used to be false
positives — an `effect` in an abortable scope, `addEventListener` inside an observable
descriptor, an outbound `URLSearchParams`, a `BroadcastChannel` constructed for its own
extension, a `computed` derived from `ready()`, a timer touching no unit. A finding against
it means a rule has drifted back to flagging correct code. **Calibration itself has not been
re-run** — it needs live agents, and the session limit was exhausted. That is the one
outstanding task.

### A bug the new rule found in our own golden example

`golden-example.md` — a designated clean control — read `page()` *after*
`await wrap(sleep(250))` inside `computed(async)`. Under RTM-A07 that read never becomes a
dependency, so **changing the page would not have refetched**. Fixed by hoisting the read
above the await, with a comment explaining why. The rule paid for itself before it audited
any user code.
