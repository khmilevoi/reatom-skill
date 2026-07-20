import {
  action,
  atom,
  computed,
  effect,
  sleep,
  withAbort,
  withAsync,
  withBroadcastChannel,
  withLocalStorage,
  withObservable,
  wrap,
} from '@reatom/core'

export const searchQuery = atom('', 'catalog.searchQuery')
export const searchPage = atom(1, 'catalog.searchPage')

export const catalogResults = computed(async () => {
  const query = searchQuery()
  const page = searchPage()
  if (!query) return []

  const params = new URLSearchParams({ q: query, page: String(page) })
  const response = await wrap(fetch(`https://api.example.com/search?${params}`))

  return wrap(response.json())
}, 'catalog.catalogResults').extend(withAsync())

export const catalogPending = computed(() => !catalogResults.ready(), 'catalog.catalogPending')
export const catalogError = catalogResults.error

export const viewportWidth = atom(0, 'layout.viewportWidth').extend(
  withObservable({
    initState: typeof window === 'undefined' ? 0 : window.innerWidth,
    subscribe: (next) => {
      const onResize = () => next(window.innerWidth)
      window.addEventListener('resize', onResize)
      return () => window.removeEventListener('resize', onResize)
    },
  }),
)

const preferencesChannel =
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('catalog.preferences')

export const compactMode = atom(false, 'catalog.compactMode').extend(
  withLocalStorage('catalog.compactMode'),
  preferencesChannel ? withBroadcastChannel(preferencesChannel) : (target) => target,
)

export const reatomDashboard = computed(() => {
  const refresh = action(async () => {
    const response = await wrap(fetch('/api/dashboard'))
    return wrap(response.json())
  }, 'dashboard.refresh').extend(withAsync())

  effect(async () => {
    while (true) {
      await wrap(sleep(30_000))
      refresh()
    }
  }, 'dashboard._poll')

  return { refresh }
}, 'dashboard').extend(withAbort())

export const yieldToBrowser = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
