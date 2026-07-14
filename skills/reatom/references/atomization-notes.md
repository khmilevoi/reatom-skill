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
