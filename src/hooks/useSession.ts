import { useEffect, useState } from 'react'
import { api } from '../lib/ipc'
import type { SessionSnapshot } from '../../electron/session/types'

export function useSession() {
  const [session, setSession] = useState<SessionSnapshot | null>(null)

  useEffect(() => {
    let cancelled = false
    let unsubscribe = () => {}
    try {
      void api()
        .getSession()
        .then((s) => {
          if (!cancelled) setSession(s)
        })
        .catch((err) => {
          console.error('[myCast] getSession failed', err)
        })
      unsubscribe = api().onSessionChanged((s) => {
        if (!cancelled) setSession(s)
      })
    } catch (err) {
      console.error('[myCast] session bridge unavailable', err)
    }
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return session
}
