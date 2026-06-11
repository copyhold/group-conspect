import { embed, cosineSim } from './embedder.ts'
import { getDb } from './db.ts'

export interface Meeting {
  id: string
  filename: string
  title: string
  date: string | null
  content: string
}

export function listMeetings(): Omit<Meeting, 'content'>[] {
  const db = getDb()
  return db.prepare(`
    SELECT id, filename, title, date FROM meetings ORDER BY date DESC, filename DESC
  `).all() as Omit<Meeting, 'content'>[]
}

export function getMeeting(id: string): Meeting | null {
  const db = getDb()
  return db.prepare(`SELECT * FROM meetings WHERE id = ?`).get(id) as Meeting | null
}

export async function searchMeetings(query: string): Promise<(Omit<Meeting, 'content'> & { snippet: string })[]> {
  const db = getDb()

  try {
    const queryVec = await embed(query)
    const rows = db.prepare(`SELECT id, filename, title, date, content, embedding FROM meetings WHERE embedding IS NOT NULL`).all() as (Meeting & { embedding: string })[]

    if (rows.length > 0) {
      const scored = rows
        .map(r => ({ ...r, score: cosineSim(queryVec, new Float32Array(JSON.parse(r.embedding))) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)

      return scored.map(r => ({
        id: r.id, filename: r.filename, title: r.title, date: r.date,
        snippet: r.content.slice(0, 300) + (r.content.length > 300 ? '…' : ''),
      }))
    }
  } catch (err) {
    console.warn('semantic search failed, falling back to FTS:', err)
  }

  // Fallback: FTS keyword search
  return db.prepare(`
    SELECT m.id, m.filename, m.title, m.date,
           snippet(meetings_fts, 2, '<b>', '</b>', '…', 30) AS snippet
    FROM meetings_fts
    JOIN meetings m ON m.rowid = meetings_fts.rowid
    WHERE meetings_fts MATCH ?
    ORDER BY rank
    LIMIT 20
  `).all(query) as (Omit<Meeting, 'content'> & { snippet: string })[]
}

export function getMeetingsContext(ids: string[]): string {
  const db = getDb()
  if (ids.length === 0) return ''
  const placeholders = ids.map(() => '?').join(',')
  const rows = db.prepare(`SELECT title, date, content FROM meetings WHERE id IN (${placeholders})`).all(...ids) as Pick<Meeting, 'title' | 'date' | 'content'>[]
  return rows.map(r => `# ${r.title}${r.date ? ` (${r.date})` : ''}\n\n${r.content}`).join('\n\n---\n\n')
}

export function getAllContext(): string {
  const db = getDb()
  const rows = db.prepare(`SELECT title, date, content FROM meetings ORDER BY date DESC`).all() as Pick<Meeting, 'title' | 'date' | 'content'>[]
  return rows.map(r => `# ${r.title}${r.date ? ` (${r.date})` : ''}\n\n${r.content}`).join('\n\n---\n\n')
}
