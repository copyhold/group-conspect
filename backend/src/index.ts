import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/bun'
import { listMeetings, getMeeting, searchMeetings } from './search.ts'
import { chat } from './agent.ts'
import { createBot } from './bot.ts'

const app = new Hono()
app.use('*', cors())

const api = new Hono()

api.get('/meetings', c => {
  return c.json(listMeetings())
})

api.get('/meetings/:id', c => {
  const meeting = getMeeting(c.req.param('id'))
  if (!meeting) return c.json({ error: 'Not found' }, 404)
  return c.json(meeting)
})

api.get('/search', c => {
  const q = c.req.query('q')?.trim()
  if (!q) return c.json([])
  try {
    return c.json(searchMeetings(q))
  } catch {
    return c.json([])
  }
})

api.post('/chat', async c => {
  const { messages } = await c.req.json()
  if (!Array.isArray(messages)) return c.json({ error: 'messages required' }, 400)
  console.log(`POST /chat messages=${messages.length}`)
  const reply = await chat(messages)
  console.log(`POST /chat reply chars=${reply.length}`)
  return c.json({ reply })
})

app.route('/api', api)

// Serve built frontend using get() so API routes registered above take priority
const FRONTEND_DIR = process.env.FRONTEND_DIR ?? '../frontend/dist'
app.get('/*', serveStatic({ root: FRONTEND_DIR }))
// SPA fallback — serve index.html for any path not matched above
app.get('/*', serveStatic({ path: 'index.html', root: FRONTEND_DIR }))

const PORT = Number(process.env.PORT ?? 3001)

// Start Telegram bot
if (process.env.BOT_TOKEN) {
  const bot = createBot()
  bot.start()
  console.log('Telegram bot started')
}

Bun.serve({ fetch: app.fetch, port: PORT })
console.log(`Backend running on http://localhost:${PORT}`)
