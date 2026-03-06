import { NextRequest, NextResponse } from 'next/server'
import { sendMessage } from '@/lib/telegram'
import { supabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const message = body.message
  if (!message) return NextResponse.json({ ok: true })

  const chatId = message.chat.id
  const text = message.text || ''

  // 유저 등록 (없으면 자동 생성)
  await supabase
    .from('users')
    .upsert(
      { telegram_chat_id: chatId, name: message.from.first_name },
      { onConflict: 'telegram_chat_id' }
    )
    .select()
    .single()

  if (text === '/start') {
    await sendMessage(chatId, `안녕하세요 ${message.from.first_name}님! 리마인더 봇입니다. 🔔`)
  } else {
    await sendMessage(chatId, '명령어를 인식하지 못했어요.')
  }

  return NextResponse.json({ ok: true })
}
