<!-- GENERATED from rules.md by development/build-rule-slices.js. DO NOT EDIT. -->

# Reatom rule registry — state

The `state` slice of `rules.md`. Rules from other domains are owned by
other auditors and are deliberately absent.

### RTM-S01 — Direct updates use atom.set
- domain: state
- kind: anti-pattern
- bad: `const setUser = action((value) => user.set(value), 'setUser')`
- good: `user.set(value)` at the call site
- detect: an action whose entire body forwards its argument into one atom
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
- exception: a single trivial paired set inside one user gesture
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
- detect: a DOM handler performing two or more model sets, or a semantically-named transition authored in `ui/`
- trigger: .set(, onClick
- exception: a single trivial `atom.set(value)` — see RTM-S01
- ref: react-guide.md#React-to-Reatom decision guide

### RTM-S05 — Name every unit
- domain: state
- kind: hygiene
- bad: `atom(0)`, `computed(() => …)`, `action(async () => …)`
- good: `atom(0, 'users.page')`, and a `${modelName}.field` convention inside factories
- detect: any `atom`/`computed`/`action`/`reatomRoute` created without a name argument
- trigger: atom(, computed(, action(, reatomRoute
- exception: none
- ref: upstream/review.md#Atom Factory Named Like A Getter

### RTM-S06 — Collapse hook orchestration into one computed
- domain: state
- kind: reinvention
- bad: `canLoadAtom` gating several async units, mirroring React `enabled` flags
- good: one `computed(async)` with early returns, extended with `withAsyncData`
- detect: enabled-flag objects, placeholder params, or duplicated state coordinating async timing
- trigger: computed(, enabled, canLoad, atom(
- exception: genuinely independent flows with separate lifetimes
- ref: react-guide.md#Before/after: enabled flags and async queries
