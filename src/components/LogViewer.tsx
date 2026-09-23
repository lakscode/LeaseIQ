import { useCallback, useEffect, useState } from 'react'
import { fetchFileLogs, type LeaseFile, type LeaseFileLog } from '../lib/leases'

const REFRESH_MS = 3000

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour12: false, fractionalSecondDigits: 3 } as Intl.DateTimeFormatOptions)

const toText = (logs: LeaseFileLog[]) =>
  logs
    .map((l) => {
      const data = l.data ? ` ${JSON.stringify(l.data)}` : ''
      return `${l.created_at} [${l.source}] ${l.level.toUpperCase()} ${l.step}: ${l.message}${data}`
    })
    .join('\n')

/** Modal with the step-by-step processing log of one uploaded file. */
export function LogViewer({ file, live, onClose }: { file: LeaseFile; live: boolean; onClose: () => void }) {
  const [logs, setLogs] = useState<LeaseFileLog[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [openData, setOpenData] = useState<Set<number>>(new Set())

  const load = useCallback(() => {
    fetchFileLogs(file.id).then(
      (rows) => {
        setLogs(rows)
        setError(null)
      },
      (e) => setError(e.message),
    )
  }, [file.id])

  useEffect(() => {
    load()
    if (!live) return
    const t = setInterval(load, REFRESH_MS)
    return () => clearInterval(t)
  }, [load, live])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const copy = async () => {
    if (!logs) return
    await navigator.clipboard.writeText(`File: ${file.file_name} (${file.id})\nStatus: ${file.status}\n\n${toText(logs)}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const toggleData = (id: number) =>
    setOpenData((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Log for ${file.file_name}`}>
        <div className="modal-header">
          <div>
            <h3>Processing log</h3>
            <div className="muted small">
              {file.file_name}
              {live && ' · refreshing live'}
            </div>
          </div>
          <div className="actions">
            <button className="btn btn-ghost btn-sm" onClick={copy} disabled={!logs?.length}>
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
          </div>
        </div>
        <div className="modal-body">
          {error && (
            <p className="error">
              {error}
              {error.includes('lease_file_logs') && ' (apply the lease_file_logs migration to enable saved logs)'}
            </p>
          )}
          {!logs && !error && <p className="muted">Loading log…</p>}
          {logs?.length === 0 && <p className="muted">No log entries yet.</p>}
          {logs && logs.length > 0 && (
            <ol className="log-list">
              {logs.map((l) => (
                <li key={l.id} className={`log-entry log-${l.level}`}>
                  <span className="log-time">{formatTime(l.created_at)}</span>
                  <span className={`log-source log-source-${l.source}`}>{l.source === 'function' ? 'server' : 'browser'}</span>
                  <span className="log-step">{l.step}</span>
                  <span className="log-message">
                    {l.message}
                    {l.data && (
                      <button className="link log-data-toggle" onClick={() => toggleData(l.id)}>
                        {openData.has(l.id) ? 'hide details' : 'details'}
                      </button>
                    )}
                    {l.data && openData.has(l.id) && <pre className="log-data">{JSON.stringify(l.data, null, 2)}</pre>}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  )
}
