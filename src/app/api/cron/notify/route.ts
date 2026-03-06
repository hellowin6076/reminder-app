import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { sendMessage } from '@/lib/telegram'

// 알림 주기 (일 기준)
const NOTIFY_DAYS_HIGH = [30, 7, 3, 0]
const NOTIFY_DAYS_NORMAL = [7, 3, 0]

function getDaysUntil(month: number, day: number, today: Date): number {
  const year = today.getFullYear()
  let target = new Date(year, month - 1, day)

  // 이미 지났으면 내년으로
  if (target < today) {
    target = new Date(year + 1, month - 1, day)
  }

  const diff = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  return diff
}

function getDaysUntilEvent(eventDate: string, today: Date): number {
  const target = new Date(eventDate)
  const diff = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  return diff
}

export async function GET(req: NextRequest) {
  // Vercel Cron 보안
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 오늘 날짜 (JST)
  const now = new Date()
  const today = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  today.setHours(0, 0, 0, 0)

  // 모든 리마인더 + 유저 조회
  const { data: reminders } = await supabase
    .from('reminders')
    .select('*, users(telegram_chat_id, name)')

  if (!reminders || reminders.length === 0) {
    return NextResponse.json({ ok: true, sent: 0 })
  }

  let sentCount = 0

  for (const reminder of reminders) {
    const chatId = reminder.users?.telegram_chat_id
    if (!chatId) continue

    const notifyDays = reminder.importance === 'high' ? NOTIFY_DAYS_HIGH : NOTIFY_DAYS_NORMAL
    const customDays = reminder.custom_notify_days

    const daysToCheck = customDays && customDays.length > 0 ? customDays : notifyDays

    let daysUntil: number

    if (reminder.type === 'anniversary') {
      daysUntil = getDaysUntil(reminder.month, reminder.day, today)
    } else {
      // 이미 지난 이벤트는 스킵
      daysUntil = getDaysUntilEvent(reminder.event_date, today)
      if (daysUntil < 0) continue
    }

    if (!daysToCheck.includes(daysUntil)) continue

    // 알림 메시지 작성
    let msg = ''
    if (daysUntil === 0) {
      msg = `🔔 오늘이에요!\n📌 ${reminder.title}`
      if (reminder.type === 'anniversary') {
        msg += `\n🎉 매년 이 날을 잊지 마세요!`
      }
    } else {
      msg = `⏰ ${daysUntil}일 후\n📌 ${reminder.title}`
      if (reminder.type === 'anniversary') {
        msg += `\n📅 매년 ${reminder.month}월 ${reminder.day}일`
      } else {
        msg += `\n📅 ${reminder.event_date}`
      }
    }

    if (reminder.memo) {
      msg += `\n📝 ${reminder.memo}`
    }

    await sendMessage(chatId, msg)
    sentCount++
  }

  return NextResponse.json({ ok: true, sent: sentCount })
}
