import { useEffect, useState } from 'react'
import { api } from '../lib/ipc'
import type { SessionSnapshot } from '../../electron/session/types'

export function useSession() {
  const [session, setSession] = useState<SessionSnapshot | null>(null)

  useEffect(() => {
    void api().getSession().then(setSession)
    return api().onSessionChanged(setSession)
  }, [])

  return session
}
