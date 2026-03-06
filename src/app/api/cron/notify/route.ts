import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { sendMessage } from '@/lib/telegram'

const NOTIFY_DAYS_HIGH = [30, 7, 3, 0]
const NOTIFY_DAYS_NORMAL = [7, 3, 0]

function getDaysUntil(month: number, day: number, today: Date): number {
  const year = today.getFullYear()
  let target = new Date(year, month - 1, day)
  if (target < today) target = new Date(year + 1, month - 1, day)
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

function getDaysUntilDate(dateStr: string, today: Date): number {
  const target = new Date(dateStr)
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

function toDateStr(date: Date): string {
  return date.toISOString().split('T')[0]
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const today = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  today.setHours(0, 0, 0, 0)
  const todayStr = toDateStr(today)

  const { data: reminders } = await supabase
    .from('reminders')
    .select('*, users(telegram_chat_id, name)')

  if (!reminders || reminders.length === 0) {
    return NextResponse.json({ ok: true, sent: 0 })
  }

  // 세션 upsert 헬퍼
  async function setSession(chatId: number, step: string, data: object) {
    await supabase
      .from('sessions')
      .upsert({ chat_id: chatId, step, data, updated_at: new Date().toISOString() })
  }

  let sentCount = 0

  for (const reminder of reminders) {
    const chatId = reminder.users?.telegram_chat_id
    if (!chatId) continue

    // ── 할 일 처리 ──────────────────────────────────────
    if (reminder.type === 'todo') {
      const intervalDays = reminder.interval_days || 5
      const lastNotified = reminder.last_notified_at

      // 마감일 당일 → 갱신 여부 묻기
      if (reminder.due_date) {
        const daysUntilDue = getDaysUntilDate(reminder.due_date, today)

        if (daysUntilDue === 0) {
          await setSession(chatId, 'todo_due_action', { reminderId: reminder.id, title: reminder.title })
          await sendMessage(
            chatId,
            `⚠️ 마감일이 됐어요!\n📌 ${reminder.title}\n\n어떻게 할까요?\n1. 완료 (삭제)\n2. 3달 연장\n3. 1년 연장`
          )
          await supabase.from('reminders').update({ last_notified_at: todayStr }).eq('id', reminder.id)
          sentCount++
          continue
        }
      }

      // 마지막 알림 이후 interval_days 지났는지 확인
      if (lastNotified) {
        const last = new Date(lastNotified)
        const daysSinceLast = Math.round((today.getTime() - last.getTime()) / (1000 * 60 * 60 * 24))
        if (daysSinceLast < intervalDays) continue
      }

      // 일반 주기 알림
      let dueMsg = ''
      if (reminder.due_date) {
        const daysUntilDue = getDaysUntilDate(reminder.due_date, today)
        if (daysUntilDue < 0) {
          dueMsg = `\n⚠️ 마감일이 ${Math.abs(daysUntilDue)}일 지났어요!`
        } else {
          dueMsg = `\n📅 마감까지 D-${daysUntilDue}`
        }
      }

      await sendMessage(
        chatId,
        `⏰ 아직 안 하셨나요?\n📌 ${reminder.title}${dueMsg}\n\n완료했으면 /done 으로 처리해주세요.`
      )
      await supabase.from('reminders').update({ last_notified_at: todayStr }).eq('id', reminder.id)
      sentCount++
      continue
    }

    // ── 기념일 / 일정 처리 ──────────────────────────────
    const notifyDays = reminder.importance === 'high' ? NOTIFY_DAYS_HIGH : NOTIFY_DAYS_NORMAL
    const customDays = reminder.custom_notify_days
    const daysToCheck = customDays && customDays.length > 0 ? customDays : notifyDays

    let daysUntil: number
    if (reminder.type === 'anniversary') {
      daysUntil = getDaysUntil(reminder.month, reminder.day, today)
    } else {
      daysUntil = getDaysUntilDate(reminder.event_date, today)
      if (daysUntil < 0) continue
    }

    if (!daysToCheck.includes(daysUntil)) continue

    let msg = ''
    if (daysUntil === 0) {
      msg = `🔔 오늘이에요!\n📌 ${reminder.title}`
      if (reminder.type === 'anniversary') msg += `\n🎉 매년 이 날을 잊지 마세요!`
    } else {
      msg = `⏰ ${daysUntil}일 후\n📌 ${reminder.title}`
      if (reminder.type === 'anniversary') {
        msg += `\n📅 매년 ${reminder.month}월 ${reminder.day}일`
      } else {
        msg += `\n📅 ${reminder.event_date}`
      }
    }

    if (reminder.memo) msg += `\n📝 ${reminder.memo}`

    await sendMessage(chatId, msg)
    sentCount++
  }

  return NextResponse.json({ ok: true, sent: sentCount })
}
