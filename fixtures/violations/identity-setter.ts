import { atom, action } from '@reatom/core'

export type User = { id: string; name: string }

export const user = atom<User | null>(null, 'session.user')

export const setUserFromLogin = action((value: User) => {
  user.set(value)
}, 'session.setUserFromLogin')

export const clearUser = action(() => {
  user.set(null)
}, 'session.clearUser')
