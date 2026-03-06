import { NextRequest, NextResponse } from 'next/server'
import { sendMessage } from '@/lib/telegram'
import { supabase } from '@/lib/supabase'

async function getSession(chatId: number) {
  const { data } = await supabase
    .from('sessions')
    .select('*')
    .eq('chat_id', chatId)
    .single()
  return data
}

async function setSession(chatId: number, step: string, data: object) {
  await supabase
    .from('sessions')
    .upsert({ chat_id: chatId, step, data, updated_at: new Date().toISOString() })
}

async function clearSession(chatId: number) {
  await supabase.from('sessions').delete().eq('chat_id', chatId)
}

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
      `/month - 월별 일정 확인\n` +
      `/delete - 리마인더 삭제\n` +
      `/done - 할 일 완료 처리\n` +
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

  // /list
  if (text === '/list') {
    await setSession(chatId, 'list_select_type', {})
    await sendMessage(chatId, '어떤 종류를 볼까요?\n\n1. 기념일\n2. 일정\n3. 할 일')
    return NextResponse.json({ ok: true })
  }

  // /delete
  if (text === '/delete') {
    await setSession(chatId, 'delete_select_type', {})
    await sendMessage(chatId, '어떤 종류를 삭제할까요?\n\n1. 기념일\n2. 일정\n3. 할 일')
    return NextResponse.json({ ok: true })
  }

  // /month
  if (text === '/month') {
    await setSession(chatId, 'month_select', {})
    await sendMessage(chatId, '몇 월을 볼까요? (1-12)')
    return NextResponse.json({ ok: true })
  }

  // /done
  if (text === '/done') {
    const { data: todos } = await supabase
      .from('reminders')
      .select('*')
      .eq('user_id', user.id)
      .eq('type', 'todo')
      .order('created_at', { ascending: true })

    if (!todos || todos.length === 0) {
      await sendMessage(chatId, '등록된 할 일이 없어요.')
      return NextResponse.json({ ok: true })
    }

    let msg = '✅ 완료할 항목을 선택해주세요.\n\n'
    todos.forEach((r: any, i: number) => {
      const due = r.due_date ? ` (마감 ${r.due_date})` : ''
      msg += `${i + 1}. ${r.title}${due}\n`
    })

    await setSession(chatId, 'select_done', {
      reminderIds: todos.map((r: any) => r.id),
    })
    await sendMessage(chatId, msg)
    return NextResponse.json({ ok: true })
  }

  // /add
  if (text === '/add') {
    await setSession(chatId, 'select_type', {})
    await sendMessage(chatId, '어떤 종류의 일정인가요?\n\n1. 기념일 (매년 반복)\n2. 일정 (일회성)\n3. 할 일 (주기적 알림)')
    return NextResponse.json({ ok: true })
  }

  // 세션 없으면
  if (!session) {
    await sendMessage(chatId, '/add 로 리마인더를 등록할 수 있어요.')
    return NextResponse.json({ ok: true })
  }

  const step = session.step
  const data = session.data || {}

  // step: select_done
  if (step === 'select_done') {
    const index = parseInt(text) - 1
    const reminderIds = data.reminderIds || []

    if (isNaN(index) || index < 0 || index >= reminderIds.length) {
      await sendMessage(chatId, `1 ~ ${reminderIds.length} 사이의 번호를 입력해주세요.`)
      return NextResponse.json({ ok: true })
    }

    const reminderId = reminderIds[index]
    const { data: reminder } = await supabase
      .from('reminders')
      .select('title')
      .eq('id', reminderId)
      .single()

    await supabase.from('reminders').delete().eq('id', reminderId)
    await clearSession(chatId)
    await sendMessage(chatId, `🎉 '${reminder?.title}' 완료! 수고하셨어요.`)
    return NextResponse.json({ ok: true })
  }

  // step: month_select
  if (step === 'month_select') {
    const month = parseInt(text)
    if (isNaN(month) || month < 1 || month > 12) {
      await sendMessage(chatId, '1~12 사이의 숫자를 입력해주세요.')
      return NextResponse.json({ ok: true })
    }

    const { data: allReminders } = await supabase
      .from('reminders')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })

    await clearSession(chatId)

    const anniversaries = (allReminders || []).filter((r: any) => r.type === 'anniversary' && r.month === month)
    const events = (allReminders || []).filter((r: any) => {
      if (r.type !== 'event' || !r.event_date) return false
      return new Date(r.event_date).getMonth() + 1 === month
    })

    if (anniversaries.length === 0 && events.length === 0) {
      await sendMessage(chatId, `${month}월에 등록된 일정이 없어요.`)
      return NextResponse.json({ ok: true })
    }

    let msg = `📅 ${month}월 일정\n`

    if (anniversaries.length > 0) {
      msg += '\n🔁 기념일\n'
      anniversaries.forEach((r: any) => {
        const imp = r.importance === 'high' ? ' ⭐' : ''
        msg += `• ${r.title} (${r.month}월 ${r.day}일)${imp}\n`
      })
    }

    if (events.length > 0) {
      msg += '\n📅 일정\n'
      events.forEach((r: any) => {
        const imp = r.importance === 'high' ? ' ⭐' : ''
        msg += `• ${r.title} (${r.event_date})${imp}\n`
      })
    }

    await sendMessage(chatId, msg)
    return NextResponse.json({ ok: true })
  }

  // step: list_select_type
  if (step === 'list_select_type') {
    if (text !== '1' && text !== '2' && text !== '3') {
      await sendMessage(chatId, '1, 2, 3 중에 입력해주세요.')
      return NextResponse.json({ ok: true })
    }
    const type = text === '1' ? 'anniversary' : text === '2' ? 'event' : 'todo'
    const typeLabel = text === '1' ? '🔁 기념일' : text === '2' ? '📅 일정' : '✅ 할 일'

    const { data: reminders } = await supabase
      .from('reminders')
      .select('*')
      .eq('user_id', user.id)
      .eq('type', type)
      .order('created_at', { ascending: true })

    await clearSession(chatId)

    if (!reminders || reminders.length === 0) {
      await sendMessage(chatId, `등록된 ${typeLabel}이 없어요.`)
      return NextResponse.json({ ok: true })
    }

    let msg = `${typeLabel} 목록\n\n`
    reminders.forEach((r: any, i: number) => {
      if (type === 'anniversary') {
        const imp = r.importance === 'high' ? ' ⭐' : ''
        msg += `${i + 1}. ${r.title} (매년 ${r.month}월 ${r.day}일)${imp}\n`
      } else if (type === 'event') {
        const imp = r.importance === 'high' ? ' ⭐' : ''
        msg += `${i + 1}. ${r.title} (${r.event_date})${imp}\n`
      } else {
        const due = r.due_date ? ` 마감 ${r.due_date}` : ''
        msg += `${i + 1}. ${r.title}${due}\n`
      }
    })

    await sendMessage(chatId, msg)
    return NextResponse.json({ ok: true })
  }

  // step: delete_select_type
  if (step === 'delete_select_type') {
    if (text !== '1' && text !== '2' && text !== '3') {
      await sendMessage(chatId, '1, 2, 3 중에 입력해주세요.')
      return NextResponse.json({ ok: true })
    }
    const type = text === '1' ? 'anniversary' : text === '2' ? 'event' : 'todo'
    const typeLabel = text === '1' ? '🔁 기념일' : text === '2' ? '📅 일정' : '✅ 할 일'

    const { data: reminders } = await supabase
      .from('reminders')
      .select('*')
      .eq('user_id', user.id)
      .eq('type', type)
      .order('created_at', { ascending: true })

    if (!reminders || reminders.length === 0) {
      await clearSession(chatId)
      await sendMessage(chatId, `등록된 ${typeLabel}이 없어요.`)
      return NextResponse.json({ ok: true })
    }

    let msg = `${typeLabel} 목록\n삭제할 번호를 입력해주세요.\n\n`
    reminders.forEach((r: any, i: number) => {
      if (type === 'anniversary') {
        const imp = r.importance === 'high' ? ' ⭐' : ''
        msg += `${i + 1}. ${r.title} (매년 ${r.month}월 ${r.day}일)${imp}\n`
      } else if (type === 'event') {
        const imp = r.importance === 'high' ? ' ⭐' : ''
        msg += `${i + 1}. ${r.title} (${r.event_date})${imp}\n`
      } else {
        const due = r.due_date ? ` 마감 ${r.due_date}` : ''
        msg += `${i + 1}. ${r.title}${due}\n`
      }
    })

    await setSession(chatId, 'select_delete', {
      reminderIds: reminders.map((r: any) => r.id),
    })
    await sendMessage(chatId, msg)
    return NextResponse.json({ ok: true })
  }

  // step: select_delete
  if (step === 'select_delete') {
    const index = parseInt(text) - 1
    const reminderIds = data.reminderIds || []

    if (isNaN(index) || index < 0 || index >= reminderIds.length) {
      await sendMessage(chatId, `1 ~ ${reminderIds.length} 사이의 번호를 입력해주세요.`)
      return NextResponse.json({ ok: true })
    }

    const reminderId = reminderIds[index]
    const { data: reminder } = await supabase
      .from('reminders')
      .select('title')
      .eq('id', reminderId)
      .single()

    await supabase.from('reminders').delete().eq('id', reminderId)
    await clearSession(chatId)
    await sendMessage(chatId, `🗑️ '${reminder?.title}' 삭제됐어요.`)
    return NextResponse.json({ ok: true })
  }

  // step: todo_due_action
  if (step === 'todo_due_action') {
    if (text !== '1' && text !== '2' && text !== '3') {
      await sendMessage(chatId, '1, 2, 3 중에 입력해주세요.')
      return NextResponse.json({ ok: true })
    }

    const reminderId = data.reminderId
    const title = data.title

    if (text === '1') {
      // 완료 → 삭제
      await supabase.from('reminders').delete().eq('id', reminderId)
      await clearSession(chatId)
      await sendMessage(chatId, `🎉 '${title}' 완료! 수고하셨어요.`)
    } else {
      // 연장
      const due = new Date()
      if (text === '2') due.setMonth(due.getMonth() + 3)
      else due.setFullYear(due.getFullYear() + 1)
      const newDueDate = due.toISOString().split('T')[0]
      const label = text === '2' ? '3달' : '1년'

      await supabase.from('reminders').update({ due_date: newDueDate }).eq('id', reminderId)
      await clearSession(chatId)
      await sendMessage(chatId, `📅 '${title}' 마감일을 ${label} 연장했어요.
새 마감일: ${newDueDate}`)
    }
    return NextResponse.json({ ok: true })
  }

  // step: todo_select_due
  if (step === 'todo_select_due') {
    if (text !== '1' && text !== '2') {
      await sendMessage(chatId, '1 또는 2를 입력해주세요.')
      return NextResponse.json({ ok: true })
    }
    const due = new Date()
    if (text === '1') due.setMonth(due.getMonth() + 3)
    else due.setFullYear(due.getFullYear() + 1)
    const dueDate = due.toISOString().split('T')[0]

    await setSession(chatId, 'todo_select_interval', { ...data, due_date: dueDate })
    await sendMessage(chatId, `알림 주기를 설정해주세요. (기본: 5일)\n숫자로 입력해주세요. 예: 3`)
    return NextResponse.json({ ok: true })
  }

  // step: todo_select_interval
  if (step === 'todo_select_interval') {
    const interval = parseInt(text)
    if (isNaN(interval) || interval < 1) {
      await sendMessage(chatId, '1 이상의 숫자를 입력해주세요.')
      return NextResponse.json({ ok: true })
    }

    await supabase.from('reminders').insert({
      user_id: user.id,
      title: data.title,
      type: 'todo',
      importance: 'normal',
      due_date: data.due_date,
      interval_days: interval,
    })

    await clearSession(chatId)
    await sendMessage(
      chatId,
      `✅ 등록 완료!\n\n` +
      `📌 ${data.title} (할 일)\n` +
      `📅 마감: ${data.due_date}\n` +
      `🔔 ${interval}일마다 알림\n\n완료했으면 /done 으로 처리해주세요.`
    )
    return NextResponse.json({ ok: true })
  }

  // step: save_todo
  if (step === 'save_todo') {
    const due = new Date()
    due.setMonth(due.getMonth() + 3)
    const dueDate = due.toISOString().split('T')[0]

    await supabase.from('reminders').insert({
      user_id: user.id,
      title: data.title,
      type: 'todo',
      importance: 'normal',
      due_date: dueDate,
      interval_days: 5,
    })

    await clearSession(chatId)
    await sendMessage(
      chatId,
      `✅ 등록 완료!\n\n` +
      `📌 ${data.title} (할 일)\n` +
      `📅 마감: ${dueDate}\n` +
      `🔔 5일마다 알림\n\n완료했으면 /done 으로 처리해주세요.`
    )
    return NextResponse.json({ ok: true })
  }

  // step: select_type (add)
  if (step === 'select_type') {
    if (text === '1') {
      await setSession(chatId, 'input_title', { type: 'anniversary' })
      await sendMessage(chatId, '제목을 입력해주세요.\n예: 여자친구 생일')
    } else if (text === '2') {
      await setSession(chatId, 'input_title', { type: 'event' })
      await sendMessage(chatId, '제목을 입력해주세요.\n예: 도쿄 여행')
    } else if (text === '3') {
      await setSession(chatId, 'input_title', { type: 'todo' })
      await sendMessage(chatId, '제목을 입력해주세요.\n예: 운전면허 갱신')
    } else {
      await sendMessage(chatId, '1, 2, 3 중에 입력해주세요.')
    }
    return NextResponse.json({ ok: true })
  }

  // step: input_title
  if (step === 'input_title') {
    // 할 일은 마감일 선택으로
    if (data.type === 'todo') {
      await setSession(chatId, 'todo_select_due', { ...data, title: text })
      await sendMessage(chatId, '마감일을 설정해주세요.\n\n1. 3달 후\n2. 1년 후')
      return NextResponse.json({ ok: true })
    }

    const nextStep = data.type === 'anniversary' ? 'input_month_day' : 'input_date'
    await setSession(chatId, nextStep, {
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
    await sendMessage(chatId, '중요도를 선택해주세요.\n\n1. 중요 (1달 전부터 알림)\n2. 일반 (1주일 전부터 알림)')
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
    await sendMessage(chatId, '중요도를 선택해주세요.\n\n1. 중요 (1달 전부터 알림)\n2. 일반 (1주일 전부터 알림)')
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

    // 마감일: 등록일 + 3달 (todo만)
    const dueDate = finalData.type === 'todo'
      ? (() => {
          const d = new Date()
          d.setMonth(d.getMonth() + 3)
          return d.toISOString().split('T')[0]
        })()
      : null

    await supabase.from('reminders').insert({
      user_id: user.id,
      title: finalData.title,
      type: finalData.type,
      importance: finalData.importance,
      month: finalData.month || null,
      day: finalData.day || null,
      event_date: finalData.event_date || null,
      due_date: dueDate,
      interval_days: finalData.type === 'todo' ? 5 : null,
    })

    await clearSession(chatId)

    let confirmMsg = ''
    if (finalData.type === 'todo') {
      confirmMsg =
        `✅ 등록 완료!\n\n` +
        `📌 ${finalData.title} (할 일)\n` +
        `📅 마감: ${dueDate}\n` +
        `🔔 5일마다 알림\n\n완료했으면 /done 으로 처리해주세요.`
    } else {
      const typeLabel = finalData.type === 'anniversary' ? '기념일' : '일정'
      const dateLabel = finalData.type === 'anniversary'
        ? `매년 ${finalData.month}월 ${finalData.day}일`
        : finalData.event_date
      const notifyLabel = importance === 'high'
        ? '1달 전 → 1주일 전 → 3일 전 → 당일 아침'
        : '1주일 전 → 3일 전 → 당일 아침'
      confirmMsg =
        `✅ 등록 완료!\n\n` +
        `📌 ${finalData.title} (${typeLabel})\n` +
        `📅 ${dateLabel}\n` +
        `🔔 ${notifyLabel}`
    }

    await sendMessage(chatId, confirmMsg)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ ok: true })
}
