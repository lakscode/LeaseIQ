import { useEffect, useState } from 'react'
import { fetchLeaseClauses, LOW_CONFIDENCE_SCORE, type LeaseClause } from '../lib/leases'

/** Clauses of one document, grouped by their SVM label. */
export function LeaseClauses({ leaseId }: { leaseId: string }) {
  const [clauses, setClauses] = useState<LeaseClause[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchLeaseClauses(leaseId).then(setClauses, (e) => setError(e.message))
  }, [leaseId])

  if (error) return <p className="error small">Could not load clauses: {error}</p>
  if (!clauses) return <p className="muted small">Loading clauses…</p>
  if (!clauses.length) return <p className="muted small">No clauses yet. Re-analyze the file to classify its clauses.</p>

  const groups = new Map<string, LeaseClause[]>()
  for (const c of clauses) groups.set(c.label, [...(groups.get(c.label) ?? []), c])
  const sorted = [...groups].sort((a, b) => a[0].localeCompare(b[0]))
  const uncertain = clauses.filter((c) => c.score < LOW_CONFIDENCE_SCORE).length

  return (
    <div className="clauses">
      <h4>
        Clauses <span className="muted small">{clauses.length} found · {uncertain} uncertain</span>
      </h4>
      {sorted.map(([label, items]) => (
        <details key={label} className="clause-group">
          <summary>
            {label} <span className="muted small">({items.length})</span>
          </summary>
          {items.map((c) => (
            <div key={c.id} className="clause">
              <div className="muted small">
                p. {c.page_number}
                {c.score < LOW_CONFIDENCE_SCORE && (
                  <span className="badge badge-pending clause-uncertain" title={`SVM score ${c.score}`}>
                    uncertain{c.alternatives.length ? ` · or ${c.alternatives.map((a) => a.label).join(', ')}` : ''}
                  </span>
                )}
              </div>
              <p>{c.text}</p>
            </div>
          ))}
        </details>
      ))}
    </div>
  )
}
