const BASE = import.meta.env.VITE_API_URL ?? '/api'

export interface Meeting {
  id: string
  filename: string
  title: string
  date: string | null
}

export interface MeetingFull extends Meeting {
  content: string
}

export interface SearchResult extends Meeting {
  snippet: string
}

export async function fetchMeetings(): Promise<Meeting[]> {
  const r = await fetch(`${BASE}/meetings`)
  if (!r.ok) throw new Error('Failed to load meetings')
  return r.json()
}

export async function fetchMeeting(id: string): Promise<MeetingFull> {
  const r = await fetch(`${BASE}/meetings/${id}`)
  if (!r.ok) throw new Error('Meeting not found')
  return r.json()
}

export async function searchMeetings(q: string): Promise<SearchResult[]> {
  const r = await fetch(`${BASE}/search?q=${encodeURIComponent(q)}`)
  if (!r.ok) return []
  return r.json()
}

export async function sendChatMessage(
  messages: { role: 'user' | 'assistant'; content: string }[],
): Promise<string> {
  const r = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  })
  if (!r.ok) throw new Error('Chat failed')
  const data = await r.json()
  return data.reply
}
