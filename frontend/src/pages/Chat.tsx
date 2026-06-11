import { useState, useRef, useEffect } from 'react'
import { sendChatMessage } from '../api'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface Props {
  onBack: () => void
}

export default function Chat({ onBack }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function send() {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    const next: Message[] = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setLoading(true)
    try {
      const reply = await sendChatMessage(next)
      setMessages([...next, { role: 'assistant', content: reply }])
    } catch {
      setMessages([...next, { role: 'assistant', content: '⚠️ Ошибка. Попробуй ещё раз.' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
      <div style={{ padding: '12px 16px', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onBack} style={{ background: 'none', color: 'var(--accent)', padding: '6px 0', fontWeight: 400 }}>
          ← Назад
        </button>
        <span style={{ fontWeight: 500 }}>Спросить агента</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.length === 0 && (
          <p style={{ color: 'var(--hint)', textAlign: 'center', marginTop: 40 }}>
            Задай вопрос по конспектам встреч
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '85%',
            background: m.role === 'user' ? 'var(--button)' : 'var(--bg-secondary)',
            color: m.role === 'user' ? 'var(--button-text)' : 'var(--text)',
            padding: '10px 14px',
            borderRadius: 14,
            whiteSpace: 'pre-wrap',
            fontSize: 14,
          }}>
            {m.content}
          </div>
        ))}
        {loading && (
          <div style={{ alignSelf: 'flex-start', color: 'var(--hint)', fontSize: 14, padding: '4px 0' }}>
            Думаю…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={{ padding: '12px 16px', background: 'var(--bg-secondary)', display: 'flex', gap: 8 }}>
        <input
          placeholder="Сообщение…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
          disabled={loading}
        />
        <button onClick={send} disabled={loading || !input.trim()} style={{ flexShrink: 0, padding: '10px 14px' }}>
          ↑
        </button>
      </div>
    </div>
  )
}
