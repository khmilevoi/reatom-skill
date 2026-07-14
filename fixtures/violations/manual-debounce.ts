import { atom, action, wrap } from '@reatom/core'

export const query = atom('', 'search.query')
export const results = atom<Array<string>>([], 'search.results')

let debounceTimer: ReturnType<typeof setTimeout> | undefined

const runSearch = action(async () => {
  const response = await wrap(fetch(`/api/search?q=${query()}`))
  results.set(await wrap(response.json()))
}, 'search.run')

export function onQueryInput(next: string) {
  query.set(next)
  if (debounceTimer !== undefined) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    void runSearch()
  }, 250)
}
