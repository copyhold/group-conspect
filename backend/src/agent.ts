import { generateText } from 'ai'
import { google } from '@ai-sdk/google'
import { searchMeetings, getMeetingsContext } from './search.ts'

const MODEL = process.env.AI_MODEL ?? 'gemini-3.0-flash'

// Swap provider here by changing the model() call:
// import { anthropic } from '@ai-sdk/anthropic' → anthropic('claude-sonnet-4-6')
// import { openai } from '@ai-sdk/openai'       → openai('gpt-4o')
function getModel() {
  return google(MODEL)
}

export async function chat(
  messages: { role: 'user' | 'assistant'; content: string }[],
): Promise<string> {
  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content ?? ''

  // RAG: search relevant meetings for the last user message
  console.log(`chat model=${MODEL} messages=${messages.length} last="${lastUserMessage.slice(0, 80)}"`)

  let context = ''
  try {
    const results = await searchMeetings(lastUserMessage)
    console.log(`chat rag hits=${results.length}`)
    if (results.length > 0) {
      const ids = results.slice(0, 5).map(r => r.id)
      context = getMeetingsContext(ids)
      console.log(`chat context chars=${context.length}`)
    }
  } catch (err) {
    console.warn('chat rag error:', err)
  }

  const system = `Ты — помощник, который отвечает на вопросы по конспектам групповых встреч.
Отвечай на русском языке. Будь конкретным — ссылайся на конкретные встречи.
Если информации нет в конспектах — так и скажи.

${context ? `КОНСПЕКТЫ ВСТРЕЧ:\n\n${context}` : 'Конспекты встреч пока не найдены по этому запросу.'}`

  const { text } = await generateText({
    model: getModel(),
    system,
    messages,
  })

  return text
}
