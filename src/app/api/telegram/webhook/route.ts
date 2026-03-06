import { NextRequest, NextResponse } from 'next/server'
import { sendMessage } from '@/lib/telegram'
import { supabase } from '@/lib/supabase'

// 세션 가져오기
async function getSession(chatId: number) {
  const { data } = await supabase
    .from('sessions')
    .select('*')
    .eq('chat_id', chatId)
    .single()
  return data
}

// 세션 저장
async function setSession(chatId: number, step: string, data: object) {
  await supabase
    .from('sessions')
    .upsert({ chat_id: chatId, step, data, updated_at: new Date().toISOString() })
}

// 세션 삭제
async function clearSession(chatId: number) {
  await supabase.from('sessions').delete().eq('chat_id', chatId)
}

// 유저 가져오기 or 생성
async function getOrCreateUser(chatId: number, firstName: string) {
  const { data } = await supabase
    .from('users')
    .upsert(
      { telegram_chat_id: chatId, name: firstName },
      { onConflict: 'telegram_chat_id' }
    )
    .select()
    .single()
  return data
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const message = body.message
  if (!message) return NextResponse.json({ ok: true })

  const chatId = message.chat.id
  const text = (message.text || '').trim()
  const firstName = message.from.first_name

  const user = await getOrCreateUser(chatId, firstName)
  const session = await getSession(chatId)

  // /start
  if (text === '/start') {
    await clearSession(chatId)
    await sendMessage(
      chatId,
      `안녕하세요 ${firstName}님! 리마인더 봇입니다. 🔔\n\n` +
      `명령어 목록:\n` +
      `/add - 리마인더 등록\n` +
      `/list - 리마인더 목록\n` +
      `/cancel - 취소`
    )
    return NextResponse.json({ ok: true })
  }

  // /cancel
  if (text === '/cancel') {
    await clearSession(chatId)
    await sendMessage(chatId, '취소됐어요.')
    return NextResponse.json({ ok: true })
  }

  // /add 시작
  if (text === '/add') {
    await setSession(chatId, 'select_type', {})
    await sendMessage(
      chatId,
      '어떤 종류의 일정인가요?\n\n1. 기념일 (매년 반복)\n2. 일정 (일회성)'
    )
    return NextResponse.json({ ok: true })
  }

  // 세션 없으면 무시
  if (!session) {
    await sendMessage(chatId, '/add 로 리마인더를 등록할 수 있어요.')
    return NextResponse.json({ ok: true })
  }

  const step = session.step
  const data = session.data || {}

  // step: select_type
  if (step === 'select_type') {
    if (text === '1') {
      await setSession(chatId, 'input_title', { type: 'anniversary' })
      await sendMessage(chatId, '제목을 입력해주세요.\n예: 여자친구 생일')
    } else if (text === '2') {
      await setSession(chatId, 'input_title', { type: 'event' })
      await sendMessage(chatId, '제목을 입력해주세요.\n예: 도쿄 여행')
    } else {
      await sendMessage(chatId, '1 또는 2를 입력해주세요.')
    }
    return NextResponse.json({ ok: true })
  }

  // step: input_title
  if (step === 'input_title') {
    await setSession(chatId, data.type === 'anniversary' ? 'input_month_day' : 'input_date', {
      ...data,
      title: text,
    })
    if (data.type === 'anniversary') {
      await sendMessage(chatId, '날짜를 입력해주세요. (MM/DD 형식)\n예: 03/15')
    } else {
      await sendMessage(chatId, '날짜를 입력해주세요. (YYYY/MM/DD 형식)\n예: 2026/05/10')
    }
    return NextResponse.json({ ok: true })
  }

  // step: input_month_day (기념일)
  if (step === 'input_month_day') {
    const match = text.match(/^(\d{1,2})\/(\d{1,2})$/)
    if (!match) {
      await sendMessage(chatId, 'MM/DD 형식으로 입력해주세요.\n예: 03/15')
      return NextResponse.json({ ok: true })
    }
    const month = parseInt(match[1])
    const day = parseInt(match[2])
    await setSession(chatId, 'select_importance', { ...data, month, day })
    await sendMessage(
      chatId,
      '중요도를 선택해주세요.\n\n1. 중요 (1달 전부터 알림)\n2. 일반 (1주일 전부터 알림)'
    )
    return NextResponse.json({ ok: true })
  }

  // step: input_date (일정)
  if (step === 'input_date') {
    const match = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/)
    if (!match) {
      await sendMessage(chatId, 'YYYY/MM/DD 형식으로 입력해주세요.\n예: 2026/05/10')
      return NextResponse.json({ ok: true })
    }
    const event_date = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
    await setSession(chatId, 'select_importance', { ...data, event_date })
    await sendMessage(
      chatId,
      '중요도를 선택해주세요.\n\n1. 중요 (1달 전부터 알림)\n2. 일반 (1주일 전부터 알림)'
    )
    return NextResponse.json({ ok: true })
  }

  // step: select_importance
  if (step === 'select_importance') {
    if (text !== '1' && text !== '2') {
      await sendMessage(chatId, '1 또는 2를 입력해주세요.')
      return NextResponse.json({ ok: true })
    }
    const importance = text === '1' ? 'high' : 'normal'
    const finalData = { ...data, importance }

    // DB 저장
    await supabase.from('reminders').insert({
      user_id: user.id,
      title: finalData.title,
      type: finalData.type,
      importance: finalData.importance,
      month: finalData.month || null,
      day: finalData.day || null,
      event_date: finalData.event_date || null,
    })

    await clearSession(chatId)

    const typeLabel = finalData.type === 'anniversary' ? '기념일' : '일정'
    const dateLabel =
      finalData.type === 'anniversary'
        ? `매년 ${finalData.month}월 ${finalData.day}일`
        : finalData.event_date
    const notifyLabel =
      importance === 'high'
        ? '1달 전 → 1주일 전 → 3일 전 → 당일 아침'
        : '1주일 전 → 3일 전 → 당일 아침'

    await sendMessage(
      chatId,
      `✅ 등록 완료!\n\n` +
      `📌 ${finalData.title} (${typeLabel})\n` +
      `📅 ${dateLabel}\n` +
      `🔔 ${notifyLabel}`
    )
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ ok: true })
}
