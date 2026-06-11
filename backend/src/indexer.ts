import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { embed } from './embedder.ts'
import { getDb } from './db.ts'

const SUMMARIES_DIR = process.env.SUMMARIES_DIR ?? path.join(process.cwd(), '../summaries')

// Extract title from first # heading
function parseTitle(content: string): string {
  const match = content.match(/^#\s+(.+)$/m)
  return match ? match[1].trim() : 'Без названия'
}

// Extract date from filename like stem_20260609_213032_summary.md
function parseDateFromFilename(filename: string): string | null {
  const match = filename.match(/(\d{8})_\d{6}/)
  if (!match) return null
  const d = match[1]
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
}

function fileId(filename: string, content: string): string {
  return crypto.createHash('sha1').update(filename + content.slice(0, 200)).digest('hex').slice(0, 16)
}

export async function indexAll() {
  const db = getDb()

  if (!fs.existsSync(SUMMARIES_DIR)) {
    console.error(`SUMMARIES_DIR not found: ${SUMMARIES_DIR}`)
    process.exit(1)
  }

  const files = fs.readdirSync(SUMMARIES_DIR).filter(f => f.endsWith('.md'))
  console.log(`Found ${files.length} markdown files in ${SUMMARIES_DIR}`)

  const upsert = db.prepare(`
    INSERT INTO meetings (id, filename, title, date, content, embedding, indexed_at)
    VALUES ($id, $filename, $title, $date, $content, $embedding, $indexed_at)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      date = excluded.date,
      content = excluded.content,
      embedding = excluded.embedding,
      indexed_at = excluded.indexed_at
  `)

  for (const filename of files) {
    const filepath = path.join(SUMMARIES_DIR, filename)
    const content = fs.readFileSync(filepath, 'utf-8')
    const id = fileId(filename, content)
    const title = parseTitle(content)
    const date = parseDateFromFilename(filename)

    let embedding: string | null = null
    try {
      const vec = await embed(`${title}\n\n${content}`)
      embedding = JSON.stringify(Array.from(vec))
    } catch (err) {
      console.warn(`  ⚠ embedding failed for ${filename}:`, err)
    }

    upsert.run({ $id: id, $filename: filename, $title: title, $date: date, $content: content, $embedding: embedding, $indexed_at: new Date().toISOString() })
    console.log(`  ✓ ${filename} → "${title}"${embedding ? ' [embedded]' : ' [no embedding]'}`)
  }

  console.log(`\nDone.`)
}

await indexAll()
