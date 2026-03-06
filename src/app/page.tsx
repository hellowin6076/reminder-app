'use client'

import { useState, useEffect, useCallback } from 'react'

type Reminder = {
  id: string
  title: string
  type: 'anniversary' | 'event' | 'todo'
  importance: 'high' | 'normal'
  month?: number
  day?: number
  event_date?: string
  memo?: string
  due_date?: string
  interval_days?: number
  created_at: string
}

type View = 'list' | 'add' | 'calendar'

function daysUntil(r: Reminder): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (r.type === 'anniversary' && r.month && r.day) {
    let target = new Date(today.getFullYear(), r.month - 1, r.day)
    if (target < today) target = new Date(today.getFullYear() + 1, r.month - 1, r.day)
    return Math.round((target.getTime() - today.getTime()) / 86400000)
  }
  if (r.event_date) {
    const target = new Date(r.event_date)
    return Math.round((target.getTime() - today.getTime()) / 86400000)
  }
  if (r.due_date) {
    const target = new Date(r.due_date)
    return Math.round((target.getTime() - today.getTime()) / 86400000)
  }
  return 999
}

function dateLabel(r: Reminder): string {
  if (r.type === 'anniversary' && r.month && r.day) return `매년 ${r.month}월 ${r.day}일`
  if (r.type === 'todo') return r.due_date ? `마감 ${r.due_date.replace(/-/g, '/')}` : '마감일 없음'
  if (r.event_date) return r.event_date.replace(/-/g, '/')
  return ''
}

function daysLabel(d: number): string {
  if (d === 0) return '오늘'
  if (d < 0) return '지남'
  return `D-${d}`
}

// ── 캘린더 ──────────────────────────────────────────────
function CalendarView({ reminders }: { reminders: Reminder[] }) {
  const [current, setCurrent] = useState(new Date())
  const year = current.getFullYear()
  const month = current.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const today = new Date()

  function getRemindersForDay(day: number): Reminder[] {
    return reminders.filter(r => {
      if (r.type === 'anniversary') return r.month === month + 1 && r.day === day
      if (r.event_date) {
        const d = new Date(r.event_date)
        return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day
      }
      return false
    })
  }

  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <button onClick={() => setCurrent(new Date(year, month - 1))} className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-500">‹</button>
        <span className="font-semibold text-gray-800">{year}년 {month + 1}월</span>
        <button onClick={() => setCurrent(new Date(year, month + 1))} className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-500">›</button>
      </div>
      <div className="grid grid-cols-7 mb-2">
        {['일','월','화','수','목','금','토'].map(d => (
          <div key={d} className="text-center text-xs text-gray-400 py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />
          const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day
          const dayReminders = getRemindersForDay(day)
          return (
            <div key={i} className={`min-h-[56px] rounded-lg p-1 ${isToday ? 'bg-indigo-50 ring-1 ring-indigo-300' : 'hover:bg-gray-50'}`}>
              <div className={`text-xs text-center mb-1 font-medium ${isToday ? 'text-indigo-600' : 'text-gray-600'}`}>{day}</div>
              {dayReminders.slice(0, 2).map(r => (
                <div key={r.id} className={`text-[10px] px-1 py-0.5 rounded truncate mb-0.5 ${r.type === 'anniversary' ? 'bg-rose-100 text-rose-700' : 'bg-blue-100 text-blue-700'}`}>
                  {r.title}
                </div>
              ))}
              {dayReminders.length > 2 && <div className="text-[10px] text-gray-400 text-center">+{dayReminders.length - 2}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── 인폴드 수정 폼 ───────────────────────────────────────
function EditForm({
  reminder,
  onSave,
  onCancel,
}: {
  reminder: Reminder
  onSave: (updated: Reminder) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState({
    title: reminder.title,
    type: reminder.type,
    importance: reminder.importance,
    month: reminder.month?.toString() || '',
    day: reminder.day?.toString() || '',
    event_date: reminder.event_date || '',
    memo: reminder.memo || '',
    due_date: reminder.due_date || '',
    interval_days: reminder.interval_days?.toString() || '5',
  })
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const body: any = {
      id: reminder.id,
      title: form.title,
      type: form.type,
      importance: form.importance,
      memo: form.memo || null,
    }
    if (form.type === 'anniversary') {
      body.month = parseInt(form.month)
      body.day = parseInt(form.day)
      body.event_date = null
      body.due_date = null
    } else if (form.type === 'todo') {
      body.due_date = form.due_date || null
      body.interval_days = parseInt(form.interval_days) || 5
      body.month = null
      body.day = null
      body.event_date = null
    } else {
      body.event_date = form.event_date
      body.month = null
      body.day = null
      body.due_date = null
    }
    const res = await fetch('/api/reminders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const updated = await res.json()
    setLoading(false)
    onSave(updated)
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 pt-3 border-t border-gray-100 space-y-3">
      <input
        required
        placeholder="제목"
        value={form.title}
        onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-300"
      />

      {form.type !== 'todo' && (
        <div className="flex gap-2">
          {(['anniversary', 'event'] as const).map(t => (
            <button
              key={t} type="button"
              onClick={() => setForm(f => ({ ...f, type: t }))}
              className={`flex-1 py-2 rounded-xl text-xs font-medium transition-colors ${form.type === t ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-500'}`}
            >
              {t === 'anniversary' ? '🔁 기념일' : '📅 일정'}
            </button>
          ))}
        </div>
      )}

      {form.type === 'anniversary' ? (
        <div className="flex gap-2">
          <input
            required type="number" min="1" max="12" placeholder="월"
            value={form.month}
            onChange={e => setForm(f => ({ ...f, month: e.target.value }))}
            className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-300"
          />
          <input
            required type="number" min="1" max="31" placeholder="일"
            value={form.day}
            onChange={e => setForm(f => ({ ...f, day: e.target.value }))}
            className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </div>
      ) : form.type === 'todo' ? (
        <div className="space-y-3">
          <div>
            <p className="text-xs text-gray-500 mb-1">마감일</p>
            <input type="date"
              value={form.due_date}
              onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">알림 주기 (일)</p>
            <input type="number" min="1" placeholder="5"
              value={form.interval_days}
              onChange={e => setForm(f => ({ ...f, interval_days: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>
        </div>
      ) : (
        <input
          required type="date"
          value={form.event_date}
          onChange={e => setForm(f => ({ ...f, event_date: e.target.value }))}
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-300"
        />
      )}

      {form.type !== 'todo' && (
        <div className="flex gap-2">
          {(['normal', 'high'] as const).map(imp => (
            <button
              key={imp} type="button"
              onClick={() => setForm(f => ({ ...f, importance: imp }))}
              className={`flex-1 py-2 rounded-xl text-xs font-medium transition-colors ${form.importance === imp ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-500'}`}
            >
              {imp === 'high' ? '⭐ 중요' : '일반'}
            </button>
          ))}
        </div>
      )}

      <input
        placeholder="메모 (선택)"
        value={form.memo}
        onChange={e => setForm(f => ({ ...f, memo: e.target.value }))}
        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-300"
      />

      <div className="flex gap-2">
        <button
          type="button" onClick={onCancel}
          className="flex-1 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"
        >
          취소
        </button>
        <button
          type="submit" disabled={loading}
          className="flex-1 py-2 rounded-xl text-sm font-medium bg-indigo-500 text-white hover:bg-indigo-600 transition-colors disabled:opacity-50"
        >
          {loading ? '저장 중...' : '저장'}
        </button>
      </div>
    </form>
  )
}

// ── 메인 ────────────────────────────────────────────────
export default function Home() {
  const [authed, setAuthed] = useState(false)
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [view, setView] = useState<View>('list')
  const [filterType, setFilterType] = useState<'all' | 'anniversary' | 'event' | 'todo'>('all')
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const [form, setForm] = useState({
    title: '', type: 'anniversary', importance: 'normal',
    month: '', day: '', event_date: '', memo: '',
    due_date_option: '3months', interval_days: '5'
  })

  const fetchReminders = useCallback(async () => {
    const res = await fetch('/api/reminders')
    if (res.ok) setReminders(await res.json())
  }, [])

  useEffect(() => {
    fetch('/api/reminders').then(r => {
      if (r.ok) { setAuthed(true); fetchReminders() }
    })
  }, [fetchReminders])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    setLoading(false)
    if (res.ok) { setAuthed(true); fetchReminders() }
    else setAuthError('비밀번호가 틀렸어요.')
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const body: any = {
      title: form.title, type: form.type,
      importance: form.importance, memo: form.memo || null,
    }
    if (form.type === 'anniversary') {
      body.month = parseInt(form.month)
      body.day = parseInt(form.day)
    } else if (form.type === 'todo') {
      const due = new Date()
      if (form.due_date_option === '3months') due.setMonth(due.getMonth() + 3)
      else due.setFullYear(due.getFullYear() + 1)
      body.due_date = due.toISOString().split('T')[0]
      body.interval_days = parseInt(form.interval_days) || 5
    } else {
      body.event_date = form.event_date
    }
    await fetch('/api/reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setForm({ title: '', type: 'anniversary', importance: 'normal', month: '', day: '', event_date: '', memo: '', due_date_option: '3months', interval_days: '5' })
    setLoading(false)
    setView('list')
    fetchReminders()
  }

  async function handleDelete(id: string) {
    if (!confirm('삭제할까요?')) return
    await fetch('/api/reminders', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    fetchReminders()
  }

  async function handleComplete(id: string) {
    if (!confirm('완료 처리할까요?')) return
    await fetch('/api/reminders', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    fetchReminders()
  }

  function handleSaved(updated: Reminder) {
    setReminders(prev => prev.map(r => r.id === updated.id ? updated : r))
    setExpandedId(null)
  }

  const filtered = reminders
    .filter(r => filterType === 'all' || r.type === filterType)
    .sort((a, b) => daysUntil(a) - daysUntil(b))

  if (!authed) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="text-4xl mb-3">🔔</div>
            <h1 className="text-2xl font-bold text-gray-800">Reminder</h1>
            <p className="text-gray-400 text-sm mt-1">개인 리마인더 앱</p>
          </div>
          <form onSubmit={handleLogin} className="bg-white rounded-2xl shadow-sm p-6 space-y-4">
            <input
              type="password" placeholder="비밀번호"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-300"
            />
            {authError && <p className="text-red-500 text-xs">{authError}</p>}
            <button type="submit" disabled={loading}
              className="w-full bg-indigo-500 text-white rounded-xl py-3 text-sm font-medium hover:bg-indigo-600 transition-colors disabled:opacity-50">
              {loading ? '...' : '입장'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-lg mx-auto px-4 py-8">

        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">🔔 Reminder</h1>
            <p className="text-gray-400 text-xs mt-0.5">{reminders.length}개의 리마인더</p>
          </div>
          <button
            onClick={() => setView(view === 'add' ? 'list' : 'add')}
            className="bg-indigo-500 text-white rounded-xl px-4 py-2 text-sm font-medium hover:bg-indigo-600 transition-colors"
          >
            {view === 'add' ? '취소' : '+ 등록'}
          </button>
        </div>

        <div className="flex gap-2 mb-6">
          {(['list', 'calendar'] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${view === v ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}>
              {v === 'list' ? '목록' : '캘린더'}
            </button>
          ))}
        </div>

        {/* 등록 폼 */}
        {view === 'add' && (
          <form onSubmit={handleAdd} className="bg-white rounded-2xl shadow-sm p-6 mb-6 space-y-4">
            <h2 className="font-semibold text-gray-700">새 리마인더</h2>
            <input required placeholder="제목" value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-300" />
            <div className="flex gap-2">
              {(['anniversary', 'event', 'todo'] as const).map(t => (
                <button key={t} type="button" onClick={() => setForm(f => ({ ...f, type: t }))}
                  className={`flex-1 py-2 rounded-xl text-xs font-medium transition-colors ${form.type === t ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-500'}`}>
                  {t === 'anniversary' ? '🔁 기념일' : t === 'event' ? '📅 일정' : '✅ 할 일'}
                </button>
              ))}
            </div>
            {form.type === 'anniversary' ? (
              <div className="flex gap-2">
                <input required type="number" min="1" max="12" placeholder="월" value={form.month}
                  onChange={e => setForm(f => ({ ...f, month: e.target.value }))}
                  className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-300" />
                <input required type="number" min="1" max="31" placeholder="일" value={form.day}
                  onChange={e => setForm(f => ({ ...f, day: e.target.value }))}
                  className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
            ) : form.type === 'todo' ? (
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-gray-500 mb-2">마감일</p>
                  <div className="flex gap-2">
                    {([['3months', '3달 후'], ['1year', '1년 후']] as const).map(([val, label]) => (
                      <button key={val} type="button"
                        onClick={() => setForm(f => ({ ...f, due_date_option: val }))}
                        className={`flex-1 py-2 rounded-xl text-xs font-medium transition-colors ${form.due_date_option === val ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-500'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-2">알림 주기 (일)</p>
                  <input type="number" min="1" placeholder="5"
                    value={form.interval_days}
                    onChange={e => setForm(f => ({ ...f, interval_days: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
              </div>
            ) : (
              <input required type="date" value={form.event_date}
                onChange={e => setForm(f => ({ ...f, event_date: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-300" />
            )}
            <div className="flex gap-2">
              {(['normal', 'high'] as const).map(imp => (
                <button key={imp} type="button" onClick={() => setForm(f => ({ ...f, importance: imp }))}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${form.importance === imp ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-500'}`}>
                  {imp === 'high' ? '⭐ 중요' : '일반'}
                </button>
              ))}
            </div>
            <input placeholder="메모 (선택)" value={form.memo}
              onChange={e => setForm(f => ({ ...f, memo: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-300" />
            <button type="submit" disabled={loading}
              className="w-full bg-indigo-500 text-white rounded-xl py-3 text-sm font-medium hover:bg-indigo-600 transition-colors disabled:opacity-50">
              {loading ? '등록 중...' : '등록'}
            </button>
          </form>
        )}

        {/* 목록 */}
        {view === 'list' && (
          <>
            <div className="flex gap-2 mb-4">
              {(['all', 'anniversary', 'event', 'todo'] as const).map(t => (
                <button key={t} onClick={() => setFilterType(t)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filterType === t ? 'bg-indigo-500 text-white' : 'bg-white text-gray-400 shadow-sm'}`}>
                  {t === 'all' ? '전체' : t === 'anniversary' ? '🔁 기념일' : t === 'event' ? '📅 일정' : '✅ 할 일'}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              {filtered.length === 0 && (
                <div className="text-center text-gray-400 text-sm py-12">리마인더가 없어요</div>
              )}
              {filtered.map(r => {
                const d = daysUntil(r)
                const isExpanded = expandedId === r.id
                return (
                  <div key={r.id} className="bg-white rounded-2xl shadow-sm p-4">
                    <div
                      className="flex items-center gap-4 cursor-pointer"
                      onClick={() => setExpandedId(isExpanded ? null : r.id)}
                    >
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0 ${d === 0 ? 'bg-rose-100 text-rose-600' : d <= 7 ? 'bg-amber-100 text-amber-600' : 'bg-gray-100 text-gray-500'}`}>
                        {daysLabel(d)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-gray-800 text-sm truncate">{r.title}</span>
                          {r.importance === 'high' && <span className="text-xs">⭐</span>}
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">{dateLabel(r)}</div>
                        {r.memo && <div className="text-xs text-gray-400 truncate mt-0.5">📝 {r.memo}</div>}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-gray-300 text-xs">{isExpanded ? '▲' : '▼'}</span>
                        {r.type === 'todo' && (
                          <button
                            onClick={e => { e.stopPropagation(); handleComplete(r.id) }}
                            className="text-gray-300 hover:text-green-500 transition-colors text-base"
                            title="완료"
                          >
                            ✓
                          </button>
                        )}
                        <button
                          onClick={e => { e.stopPropagation(); handleDelete(r.id) }}
                          className="text-gray-300 hover:text-red-400 transition-colors text-lg"
                        >
                          ×
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <EditForm
                        reminder={r}
                        onSave={handleSaved}
                        onCancel={() => setExpandedId(null)}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* 캘린더 */}
        {view === 'calendar' && (
          <div className="bg-white rounded-2xl shadow-sm p-6">
            <CalendarView reminders={reminders} />
          </div>
        )}
      </div>
    </div>
  )
}
