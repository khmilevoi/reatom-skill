import { atom, action, wrap } from '@reatom/core'

export const status = atom<'pending' | 'approved' | 'denied'>('pending', 'activation.status')

let pollIntervalId: number | undefined
let pollTicks = 0

const pollStatus = action(async () => {
  const response = await wrap(fetch('/api/activation/1/status'))
  const payload = await wrap(response.json())
  status.set(payload.status)
  if (payload.status !== 'pending') stopPolling()
}, 'activation.pollStatus')

export function beginPolling() {
  pollTicks = 0
  pollIntervalId = window.setInterval(() => {
    pollTicks += 1
    void pollStatus()
  }, 2000)
}

export function stopPolling() {
  if (pollIntervalId !== undefined) window.clearInterval(pollIntervalId)
  pollIntervalId = undefined
}
