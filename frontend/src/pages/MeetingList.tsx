import { useEffect, useState } from 'react'
import { fetchMeetings, searchMeetings, type Meeting, type SearchResult } from '../api'

interface Props {
  onSelect: (id: string) => void
  onChat: () => void
}

export default function MeetingList({ onSelect, onChat }: Props) {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchMeetings().then(setMeetings).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!query.trim()) { setResults(null); return }
    const t = setTimeout(() => {
      searchMeetings(query).then(setResults)
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  const items = results ?? meetings

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
      <div style={{ padding: '12px 16px', background: 'var(--bg-secondary)', display: 'flex', gap: 8 }}>
        <input
          placeholder="Поиск по конспектам…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <button onClick={onChat} style={{ flexShrink: 0, padding: '10px 14px' }}>💬</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && <p style={{ padding: 20, color: 'var(--hint)', textAlign: 'center' }}>Загрузка…</p>}

        {!loading && items.length === 0 && (
          <p style={{ padding: 20, color: 'var(--hint)', textAlign: 'center' }}>
            {query ? 'Ничего не найдено' : 'Конспекты не найдены'}
          </p>
        )}

        {items.map(m => (
          <div
            key={m.id}
            onClick={() => onSelect(m.id)}
            style={{
              padding: '14px 16px',
              borderBottom: '1px solid var(--bg-secondary)',
              cursor: 'pointer',
            }}
          >
            <div style={{ fontWeight: 500, marginBottom: 2 }}>{m.title}</div>
            {m.date && <div style={{ fontSize: 13, color: 'var(--hint)' }}>{m.date}</div>}
            {'snippet' in m && (
              <div
                style={{ fontSize: 13, color: 'var(--hint)', marginTop: 4 }}
                dangerouslySetInnerHTML={{ __html: (m as SearchResult).snippet }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
