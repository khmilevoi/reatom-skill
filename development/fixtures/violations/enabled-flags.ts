import { atom, computed, action, wrap } from '@reatom/core'

export const agreement = atom<{ id: string; canceled: boolean } | null>(null, 'balance.agreement')
export const permissions = atom<{ canView: boolean } | null>(null, 'balance.permissions')

export const canLoadAtom = computed(() => {
  const current = agreement()
  return Boolean(current) && !current!.canceled
}, 'balance.canLoad')

export const isBalanceLoading = atom(false, 'balance.isLoading')
export const balanceError = atom<Error | null>(null, 'balance.error')
export const balance = atom<number | null>(null, 'balance.value')

export const fetchBalance = action(async () => {
  if (!canLoadAtom()) return
  isBalanceLoading.set(true)
  try {
    const response = await wrap(fetch('/api/balance'))
    balance.set(await wrap(response.json()))
  } catch (error) {
    balanceError.set(error as Error)
  } finally {
    isBalanceLoading.set(false)
  }
}, 'balance.fetch')
