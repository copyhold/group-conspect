import { useState } from 'react'
import MeetingList from './pages/MeetingList'
import MeetingView from './pages/MeetingView'
import Chat from './pages/Chat'
import './theme.css'
import './App.css'

type View = { page: 'list' } | { page: 'meeting'; id: string } | { page: 'chat' }

export default function App() {
  const [view, setView] = useState<View>({ page: 'list' })

  // Handle hash-based deep links from Telegram inline results
  // e.g. #/meeting/abc123
  useState(() => {
    const hash = window.location.hash.replace('#', '')
    if (hash.startsWith('/meeting/')) {
      const id = hash.replace('/meeting/', '')
      if (id) setView({ page: 'meeting', id })
    }
  })

  if (view.page === 'meeting') {
    return <MeetingView id={view.id} onBack={() => setView({ page: 'list' })} />
  }
  if (view.page === 'chat') {
    return <Chat onBack={() => setView({ page: 'list' })} />
  }
  return (
    <MeetingList
      onSelect={id => setView({ page: 'meeting', id })}
      onChat={() => setView({ page: 'chat' })}
    />
  )
}
