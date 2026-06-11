import { Bot, InlineKeyboard } from 'grammy'
import { listMeetings, searchMeetings } from './search.ts'
import { chat } from './agent.ts'

const BOT_TOKEN = process.env.BOT_TOKEN ?? ''
const WEBAPP_URL = process.env.WEBAPP_URL ?? ''

function user(ctx: { from?: { id: number; username?: string; first_name?: string } }) {
  const u = ctx.from
  return u ? `[${u.id} ${u.username ?? u.first_name ?? '?'}]` : '[unknown]'
}

export function createBot() {
  if (!BOT_TOKEN) throw new Error('BOT_TOKEN is not set')
  const bot = new Bot(BOT_TOKEN)

  bot.command('start', async ctx => {
    console.log(`/start ${user(ctx)}`)
    const keyboard = new InlineKeyboard().webApp('📚 Открыть конспекты', WEBAPP_URL)
    await ctx.reply(
      'Привет! Здесь хранятся конспекты наших встреч.\n\nОткрой приложение или напиши что ищешь.',
      { reply_markup: keyboard },
    )
  })

  bot.command('list', async ctx => {
    console.log(`/list ${user(ctx)}`)
    const meetings = listMeetings().slice(0, 10)
    if (meetings.length === 0) {
      await ctx.reply('Конспектов пока нет.')
      return
    }
    const text = meetings
      .map(m => `• ${m.date ?? '??-??-????'} — ${m.title}`)
      .join('\n')
    const keyboard = new InlineKeyboard().webApp('📚 Открыть все', WEBAPP_URL)
    await ctx.reply(text, { reply_markup: keyboard })
  })

  // Regular text messages → AI chat
  bot.on('message:text', async ctx => {
    const text = ctx.message.text
    if (text.startsWith('/')) return // let command handlers deal with it
    console.log(`message:text ${user(ctx)} text="${text.slice(0, 80)}"`)
    await ctx.replyWithChatAction('typing')
    try {
      const reply = await chat([{ role: 'user', content: text }])
      await ctx.reply(reply)
    } catch (err) {
      console.error('bot chat error:', err)
      await ctx.reply('⚠️ Ошибка при обращении к агенту. Попробуй ещё раз.')
    }
  })

  // Inline mode: @bot query → list matching meetings
  bot.on('inline_query', async ctx => {
    const query = ctx.inlineQuery.query.trim()
    console.log(`inline_query ${user(ctx)} query="${query}"`)
    const meetings = query ? searchMeetings(query).slice(0, 5) : listMeetings().slice(0, 5)
    console.log(`inline_query results=${meetings.length}`)

    const results = meetings.map(m => ({
      type: 'article' as const,
      id: m.id,
      title: m.title,
      description: m.date ?? 'дата неизвестна',
      input_message_content: {
        message_text: `📄 *${m.title}*\n${m.date ?? ''}\n\n[Открыть конспект](${WEBAPP_URL}#/meeting/${m.id})`,
        parse_mode: 'Markdown' as const,
      },
    }))

    await ctx.answerInlineQuery(results, { cache_time: 30 })
  })

  return bot
}
