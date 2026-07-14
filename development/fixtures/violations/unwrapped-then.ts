import { atom, action } from '@reatom/core'

export const record = atom<unknown>(null, 'record.value')
export const isLoading = atom(false, 'record.isLoading')

export const loadRecord = action((id: string) => {
  isLoading.set(true)
  fetch(`/api/records/${id}`)
    .then((response) => response.json())
    .then((data) => {
      record.set(data)
      isLoading.set(false)
    })
}, 'record.load')

export function bindRefresh(button: HTMLButtonElement) {
  button.addEventListener('click', () => {
    void loadRecord('1')
  })
}
