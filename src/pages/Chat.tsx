import { Fragment, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { DOC_TYPE_LABELS, type Lease } from '../lib/leases'
import { askLeaseQuestion, type ChatMessage } from '../lib/chat'

const SUGGESTIONS = [
  'Which leases expire in the next 12 months?',
  'What renewal options does each lease have, and when must notice be given?',
  'Can the tenant assign or sublease without landlord consent?',
  'How are operating expenses shared, and is there a cap?',
]

// Renders **bold** spans; everything else is shown as plain text.
function renderText(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>,
  )
}

export function Chat() {
  const [params, setParams] = useSearchParams()
  const leaseId = params.get('lease')
  const [leases, setLeases] = useState<Lease[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    supabase
      .from('leases')
      .select('*')
      .order('title')
      .then(({ data }) => setLeases((data as Lease[]) ?? []))
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, busy])

  const send = async (question: string) => {
    const text = question.trim()
    if (!text || busy) return
    const history: ChatMessage[] = [...messages, { role: 'user', content: text }]
    setMessages(history)
    setInput('')
    setBusy(true)
    try {
      const { answer, sources } = await askLeaseQuestion(history, leaseId)
      setMessages((m) => [...m, { role: 'assistant', content: answer, sources }])
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', content: err instanceof Error ? err.message : String(err), error: true }])
    } finally {
      setBusy(false)
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void send(input)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send(input)
    }
  }

  const setScope = (id: string) => {
    if (id) setParams({ lease: id })
    else setParams({})
  }

  return (
    <main className="container wide chat-page">
      <div className="page-header">
        <div>
          <h1>Ask LeaseIQ</h1>
          <p className="muted">Ask anything about your leases. Answers are drawn from the lease text, with page references.</p>
        </div>
        <div className="chat-toolbar">
          <select className="select" value={leaseId ?? ''} onChange={(e) => setScope(e.target.value)} aria-label="Documents to search">
            <option value="">All documents</option>
            {leases.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title} ({DOC_TYPE_LABELS[l.doc_type]})
              </option>
            ))}
          </select>
          {messages.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={() => setMessages([])} disabled={busy}>
              New chat
            </button>
          )}
        </div>
      </div>

      <div className="chat card">
        <div className="chat-log">
          {messages.length === 0 && (
            <div className="chat-empty">
              <p className="muted">Try one of these:</p>
              <div className="chat-suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="chat-suggestion" onClick={() => void send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`chat-msg chat-${m.role}${m.error ? ' chat-error' : ''}`}>
              <div className="chat-bubble">{m.role === 'assistant' ? renderText(m.content) : m.content}</div>
              {m.sources && m.sources.length > 0 && (
                <div className="chat-sources">
                  <span className="muted small">Sources:</span>
                  {m.sources.map((s) => (
                    <Link key={`${s.leaseId}:${s.page}`} to={`/leases/${s.leaseId}`} className="chat-source" title={DOC_TYPE_LABELS[s.docType]}>
                      {s.title}, p. {s.page}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}

          {busy && (
            <div className="chat-msg chat-assistant">
              <div className="chat-bubble muted">
                <span className="spinner" role="status" aria-label="Working" /> Searching your leases…
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <form className="chat-input" onSubmit={onSubmit}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask a question about your leases…"
            rows={2}
            disabled={busy}
          />
          <button className="btn" type="submit" disabled={busy || !input.trim()}>
            Send
          </button>
        </form>
      </div>
    </main>
  )
}
