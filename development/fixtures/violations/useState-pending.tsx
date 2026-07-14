import React from 'react'
import { action, wrap } from '@reatom/core'
import { reatomComponent } from '@reatom/react'

export const startRegistration = action(async () => {
  await wrap(fetch('/api/registration', { method: 'POST' }))
}, 'registration.start')

export const RegisterButton = reatomComponent(() => {
  const [pending, setPending] = React.useState(false)

  return (
    <button
      disabled={pending}
      onClick={wrap(() => {
        setPending(true)
        void startRegistration().finally(() => setPending(false))
      })}
    >
      {pending ? 'Working…' : 'Register'}
    </button>
  )
}, 'RegisterButton')
