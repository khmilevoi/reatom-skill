<!-- GENERATED from rules.md by development/build-rule-slices.js. DO NOT EDIT. -->

# Reatom rule registry — state

The `state` slice of `rules.md`. Rules from other domains are owned by
other auditors and are deliberately absent.

### RTM-S01 — Direct updates use atom.set
- domain: state
- kind: anti-pattern
- bad: `const setUser = action((value) => user.set(value), 'setUser')`
- good: `user.set(value)` at the call site
- detect: an action whose entire body forwards its argument into one atom, or an exported one-line function that only calls `atom.set(...)`
- trigger: action(, .set(
- exception: the action also validates, maps, requests, or orchestrates
- ref: upstream/review.md#Identity Action

### RTM-S02 — Writable dependent state uses withComputed
- domain: state
- kind: reinvention
- bad: resetting `page` by hand in every handler that writes `search`, or a React `key` reset
- good: `atom(1, 'x.page').extend(withComputed((state) => { search(); return isInit() ? state : 1 }))`
- detect: the same derived reset repeated at multiple call sites, or a sync effect keeping two atoms aligned
- trigger: withComputed, atom(
- exception: a single trivial paired set inside one user gesture; a cascade resetting several unrelated atoms at once, which is `withChangeHook` territory
- ref: upstream/core.md#**withComputed**

### RTM-S03 — Atomize editable rows instead of parallel maps
- domain: state
- kind: anti-pattern
- bad: `selectedIds` / `editedTitles` maps keyed by row id
- good: a `reatomTodo(dto, name)` factory atomizing the mutable fields, readonly fields plain
- detect: state maps keyed by entity id that mirror a loaded collection
- trigger: atom(, reatom
- exception: state that genuinely belongs to the collection, not the row
- ref: upstream/core.md#Atomization

### RTM-S04 — Named model actions for grouped transitions
- domain: state
- kind: anti-pattern
- bad: `onClick={() => { model.mode.set('scanning'); model.error.set(null) }}` in the view
- good: a named `goToScan` action on the model that performs both sets
- detect: a DOM handler performing two or more raw `.set()` calls, or a semantically-named transition authored in `ui/`
- trigger: .set(, onClick, on:click
- exception: a single trivial `atom.set(value)` — see RTM-S01; composing two already-named model actions in one handler
- ref: react-guide.md#React-to-Reatom decision guide

### RTM-S05 — Name every unit
- domain: state
- kind: hygiene
- bad: `atom(0)`, `computed(() => …)`, `action(async () => …)`, `effect(async () => …)`
- good: `atom(0, 'users.page')`; inside a factory derive the name from the parent (`` `${target.name}.width` ``) or the instance (`` `image#${id}.selected` ``), and mark internal units with a leading `_`
- detect: any `atom`/`computed`/`action`/`effect`/`reatomRoute`/`reatom*` factory created with no name — whether as the second positional argument or as `name` inside an options object
- trigger: atom(, computed(, action(, effect(, reatomRoute
- exception: a unit not bound to a plain identifier — upstream's own linter deliberately reports nothing when the call has no enclosing `const` or property with an `Identifier` id
- ref: upstream/review.md#Atom Factory Named Like A Getter

### RTM-S06 — Collapse hook orchestration into one computed
- domain: state
- kind: reinvention
- bad: `canLoadAtom` gating several async units, mirroring React `enabled` flags
- good: one `computed(async)` with early returns, extended with `withAsyncData`
- detect: a separate atom, flag or placeholder param that exists to **gate or sequence** async work — `canLoad`, `enabled`, an empty-string id standing in for "not ready yet" — which an early return inside one `computed(async)` would replace
- trigger: computed(, enabled, canLoad, atom(
- exception: genuinely independent flows with separate lifetimes; plain scaffolding around a single request that gates nothing — a pending or loading flag (RTM-A02/A03), a debounce or polling timer (RTM-A05/RTM-L01), an unwrapped continuation (RTM-A04). Those belong to their own rules; the marker for this one is a gating condition, not hand-rolled async in general
- ref: react-guide.md#Before/after: enabled flags and async queries

### RTM-S07 — Derived collections are computed over the source, with a keyed model cache
- domain: state
- kind: anti-pattern
- bad: `reatomLinkedList(...).extend(withConnectHook(() => { a.subscribe(sync); b.subscribe(sync) }))` mirroring loaded data
- good: `computed(() => source().map(getModel), 'items')` plus a `Map` keyed by id, so each entity keeps one model instance
- detect: a collection primitive kept in sync by a `subscribe`/`effect` fan-out, or a model factory called without an identity cache
- trigger: reatomLinkedList, createMany, clear()
- exception: the collection is the source of truth and is mutated directly — then `reatomLinkedList` is correct
- ref: atomization-notes.md#Collections of models
