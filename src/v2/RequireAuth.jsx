import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

/* 신규 인터페이스(/app/*) 인증 게이트.
   세션 없으면 레거시 로그인(/)으로 보낸다. App.jsx의 인증과 별개로 동작(가산적). */
export default function RequireAuth({ children }) {
  const [state, setState] = useState('loading') // 'loading' | 'authed' | 'anon'

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (active) setState(session ? 'authed' : 'anon')
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setState(session ? 'authed' : 'anon')
    })
    return () => { active = false; subscription.unsubscribe() }
  }, [])

  if (state === 'loading') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888', fontSize: 14 }}>
        인증 확인 중…
      </div>
    )
  }
  if (state === 'anon') return <Navigate to="/" replace />
  return children
}
