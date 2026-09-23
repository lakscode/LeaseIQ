import { useEffect, useState } from 'react'
import { fetchPageText, type Lease } from '../lib/leases'
import type { ExtractedPage } from '../lib/pdf'

/** Modal showing the digital (or OCR-converted) text of a document's pages. */
export function TextViewer({ lease, onClose }: { lease: Lease; onClose: () => void }) {
  const [pages, setPages] = useState<ExtractedPage[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchPageText(lease.file_id, lease.page_start, lease.page_end).then(setPages, (e) => setError(e.message))
  }, [lease])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={lease.title}>
        <div className="modal-header">
          <h3>{lease.title}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="modal-body">
          {error && <p className="error">{error}</p>}
          {!pages && !error && <p className="muted">Loading text…</p>}
          {pages?.map((p) => (
            <section key={p.page_number} className="page-text">
              <h4>
                Page {p.page_number}
                {p.is_ocr && <span className="badge badge-ocr">OCR</span>}
              </h4>
              <pre>{p.text || '(no text on this page)'}</pre>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
