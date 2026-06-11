import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { fetchMeeting, type MeetingFull } from '../api'

interface Props {
  id: string
  onBack: () => void
}

export default function MeetingView({ id, onBack }: Props) {
  const [meeting, setMeeting] = useState<MeetingFull | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchMeeting(id)
      .then(setMeeting)
      .catch(() => setError('Не удалось загрузить конспект'))
      .finally(() => setLoading(false))
  }, [id])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
      <div style={{
        padding: '12px 16px',
        background: 'var(--bg-secondary)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}>
        <button onClick={onBack} style={{ background: 'none', color: 'var(--accent)', padding: '6px 0', fontWeight: 400 }}>
          ← Назад
        </button>
        {meeting && <span style={{ fontSize: 13, color: 'var(--hint)' }}>{meeting.date}</span>}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        {loading && <p style={{ color: 'var(--hint)', textAlign: 'center' }}>Загрузка…</p>}
        {error && <p style={{ color: 'red' }}>{error}</p>}
        {meeting && (
          <div className="markdown">
            <ReactMarkdown>{meeting.content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  )
}
