---
title: 'Atomization notes'
description: 'Reatom-skill additions to the upstream atomization guidance'
---

# Atomization notes

Additions to [`upstream/core.md`](./upstream/core.md#Atomization). Read that section
first; this file only covers what it leaves out.

## Where to draw the line

- Backend DTOs stay plain at the boundary; application models atomize only the fields
  that the UI or workflow mutates.
- Do not atomize everything by default. Make reactivity explicit where it buys local
  updates, subscriptions, validation, or effects.

## Why atomize editable lists

The performance model is the main reason to prefer atomization for editable lists:
changing `users()[idx].name` is an O(1) field update instead of recreating a full
array and every intermediate object on each keystroke.

## Collections of models

Atomizing one row is `RTM-S03`. This section is about the collection around it, which
has a separate failure mode.

**Owned versus derived.** The distinction decides the primitive:

- The collection **is** the source of truth and the user mutates it directly — adds,
  removes, reorders. Use `reatomLinkedList`. Node identity is the key, and structural
  updates stay incremental.
- The collection is **derived** from something else — a loaded response, a folder tree,
  the current filter and sort. Use a `computed` that maps the source, plus a cache that
  maps entity id to model instance.

```ts
const modelById = new Map<string, ItemModel>()

const getModel = (dto: ItemDto): ItemModel => {
  const cached = modelById.get(dto.id)
  if (cached) return cached
  const model = reatomItem(dto, `item#${dto.id}`)
  modelById.set(dto.id, model)
  return model
}

const items = computed(() => source().map(getModel), 'items')
```

**What goes wrong without the cache.** A model factory called straight from a `computed`
or a render builds a *new* model on every recomputation. Each rebuild throws away that
item's atom state and its `withAsyncData` cache, so per-item requests re-fire and local
edits vanish. Nothing errors; the list simply keeps forgetting.

**What goes wrong without the `computed`.** The alternative shape — hold a mutable list
primitive and keep it aligned with a `subscribe`/`effect` fan-out — gives two sources of
truth that drift, and it is what `RTM-S07` detects.

## Connection lifetime owns the async cache

An atom's async data lives exactly as long as the atom stays connected. Disconnect it and
`withAsyncData` drops what it held; connect it again and the request re-runs.

The practical consequence is about **filtering by conditional render**. Unmounting a row
disconnects its atoms, so a filter that mounts and unmounts rows silently re-fetches
everything each time a row comes back. Keep the subtree connected and hide it instead —
in DOM terms, toggle `display` rather than removing the node.

When a resource must outlive disconnection on purpose, say so explicitly: give it a
session-scoped lifetime with a single named disposal point, rather than letting connection
decide. That is the one case where a hand-written `dispose()` is not a smell.
