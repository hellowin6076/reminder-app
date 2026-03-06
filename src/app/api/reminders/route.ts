import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

function isAuthed(req: NextRequest) {
  return req.cookies.get('auth')?.value === process.env.WEB_PASSWORD
}

// GET /api/reminders
export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('reminders')
    .select('*')
    .order('created_at', { ascending: true })

  return NextResponse.json(data)
}

// POST /api/reminders
export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  // 웹에서 등록 시 첫 번째 유저 사용 (개인용)
  const { data: user } = await supabase
    .from('users')
    .select('id')
    .limit(1)
    .single()

  if (!user) return NextResponse.json({ error: 'No user found' }, { status: 400 })

  const { data, error } = await supabase.from('reminders').insert({
    user_id: user.id,
    title: body.title,
    type: body.type,
    importance: body.importance || 'normal',
    month: body.month || null,
    day: body.day || null,
    event_date: body.event_date || null,
    memo: body.memo || null,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE /api/reminders
export async function DELETE(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await req.json()
  await supabase.from('reminders').delete().eq('id', id)
  return NextResponse.json({ ok: true })
}
