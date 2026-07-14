---
title: 'Reatom v1001 golden example'
description: 'One source-backed example combining the main Reatom v1001 defaults'
---

# Reatom v1001 Golden Example

This example is based on the upstream search pattern in
[`examples/react-search/src/components/search/model.ts`](https://github.com/reatom/reatom/blob/af2f81f41da1e7f3cd815538d39c92cf4085a586/examples/react-search/src/components/search/model.ts) and
[`examples/react-search/src/components/search/SearchBar.tsx`](https://github.com/reatom/reatom/blob/af2f81f41da1e7f3cd815538d39c92cf4085a586/examples/react-search/src/components/search/SearchBar.tsx).

It demonstrates the default choices this skill should push agents toward:

- async reads with `computed(async) + withAsyncData`
- debounced query behavior with `wrap(sleep(...))`
- mutations with `action + withAsync`
- direct local updates with `atom.set`
- atomized editable row state
- React callbacks wrapped with `wrap`

```tsx
import {
  action,
  atom,
  computed,
  reatomBoolean,
  sleep,
  withAsync,
  withAsyncData,
  wrap,
} from '@reatom/core'
import { reatomComponent } from '@reatom/react'

type UserDto = {
  id: string
  name: string
}

const api = {
  async searchUsers(params: {
    query: string
    page: number
  }): Promise<{ items: Array<UserDto> }> {
    return fetch(`/api/users?q=${params.query}&page=${params.page}`).then((r) =>
      r.json(),
    )
  },
  async saveUser(user: UserDto): Promise<void> {
    await fetch(`/api/users/${user.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(user),
    })
  },
}

const reatomUser = (dto: UserDto, modelName: string): UserModel => {
  const name = atom(dto.name, `${modelName}.name`)
  const selected = reatomBoolean(false, `${modelName}.selected`)
  const dirty = reatomBoolean(false, `${modelName}.dirty`)

  const save = action(async () => {
    await wrap(api.saveUser({ id: dto.id, name: name() }))
    dirty.setFalse()
  }, `${modelName}.save`).extend(withAsync())

  return { id: dto.id, name, selected, dirty, save }
}

type UserModel = ReturnType<typeof reatomUser>

export const search = atom('', 'users.search')
export const page = atom(1, 'users.page')

export const usersResource = computed(async () => {
  const query = search()

  await wrap(sleep(250))

  if (!query) return []

  const response = await wrap(api.searchUsers({ query, page: page() }))

  return response.items.map((user) => reatomUser(user, `users#${user.id}`))
}, 'users.resource').extend(withAsyncData({ initState: [] as Array<UserModel> }))

export const UsersSearch = reatomComponent(() => {
  const users = usersResource.data()
  const ready = usersResource.ready()
  const error = usersResource.error()

  return (
    <section>
      <input
        value={search()}
        onChange={wrap((event) => {
          search.set(event.currentTarget.value)
          page.set(1)
        })}
        placeholder="Search users"
      />

      {!ready && <p>Loading...</p>}
      {error && <p>{error.message}</p>}

      <ul>
        {users.map((user) => (
          <li key={user.id}>
            <input
              type="checkbox"
              checked={user.selected()}
              onChange={wrap(() => user.selected.toggle())}
            />
            <input
              value={user.name()}
              onChange={wrap((event) => {
                user.name.set(event.currentTarget.value)
                user.dirty.setTrue()
              })}
            />
            <button
              disabled={!user.dirty() || !user.save.ready()}
              onClick={wrap(() => user.save())}
            >
              Save
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}, 'UsersSearch')
```

Notes:

- `usersResource` is lazy and only fetches while connected.
- `withAsyncData` provides `data`, `ready`, `error`, `retry`, `reset`, and `status`.
- `withAsyncData` includes abort behavior, so quick search changes do not race stale responses.
- The component uses direct `atom.set` for local assignments; no identity setter actions are needed.
- Row-level mutable state lives in each item model instead of parallel maps like `selectedIds`.
