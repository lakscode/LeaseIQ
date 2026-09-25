import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthProvider'
import { supabase } from '../lib/supabase'
import type { Lease } from '../lib/leases'
import { daysFromToday, leaseTerms } from '../lib/leaseStatus'

type Tile = [label: string, value: number | undefined, hint?: string, tone?: string]

function Tiles({ tiles }: { tiles: Tile[] }) {
  return (
    <section className="stats">
      {tiles.map(([label, value, hint, tone]) => (
        <div key={label} className={`card stat${tone ? ` stat-${tone}` : ''}`}>
          <div className="stat-label">{label}</div>
          <div className="stat-value">{value ?? '…'}</div>
          {hint && <div className="muted small">{hint}</div>}
        </div>
      ))}
    </section>
  )
}

export function Dashboard() {
  const { session } = useAuth()
  const [files, setFiles] = useState<Array<{ is_scanned: boolean }> | null>(null)
  const [leases, setLeases] = useState<Lease[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([supabase.from('lease_files').select('is_scanned'), supabase.from('leases').select('*')]).then(
      ([filesRes, leasesRes]) => {
        const err = filesRes.error ?? leasesRes.error
        if (err) setError(err.message)
        setFiles(filesRes.data ?? [])
        setLeases(leasesRes.data ?? [])
      },
    )
  }, [])

  const terms = useMemo(() => (leases ? leaseTerms(leases) : null), [leases])
  const expiringSoon = useMemo(
    () => terms?.filter((t) => t.expiringSoon).sort((a, b) => a.expiration!.getTime() - b.expiration!.getTime()) ?? [],
    [terms],
  )

  const count = (type: Lease['doc_type']) => leases?.filter((l) => l.doc_type === type).length
  const unknown = terms?.filter((t) => t.status === 'unknown').length ?? 0

  const statusTiles: Tile[] = [
    ['Active leases', terms?.filter((t) => t.status === 'active').length, 'Expiration date is today or later', 'active'],
    ['Renewed leases', terms?.filter((t) => t.renewed).length, 'Extended by an amendment or extension', 'renewed'],
    ['Expired leases', terms?.filter((t) => t.status === 'expired').length, 'Expiration date has passed', 'expired'],
    ['Expiring in 12 months', terms ? expiringSoon.length : undefined, 'Active leases ending within a year', 'soon'],
  ]

  const documentTiles: Tile[] = [
    ['Files uploaded', files?.length, files ? `${files.filter((f) => f.is_scanned).length} scanned (OCR)` : undefined],
    ['Lease documents', leases?.length, 'All documents found in uploads'],
    ['Main leases', count('main_lease')],
    ['Amendments', count('amendment')],
    ['Addenda', count('addendum')],
    ['Commencement letters', count('commencement_letter')],
    ['Other documents', count('other'), 'Assignments, guaranties, SNDAs…'],
  ]

  return (
    <main className="container wide">
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Signed in as {session?.user.email}</p>
        </div>
        <Link to="/leases" className="btn">Lease Abstraction →</Link>
      </div>

      {error && <p className="error">{error}</p>}

      <h2 className="section-title">Lease status</h2>
      <Tiles tiles={statusTiles} />
      {unknown > 0 && (
        <p className="muted small">
          {unknown} main lease{unknown === 1 ? '' : 's'} with no expiration date found {unknown === 1 ? 'is' : 'are'} not counted as active or expired.
        </p>
      )}

      <h2 className="section-title">Expiring in the next 12 months</h2>
      {!terms ? (
        <p className="muted">Loading…</p>
      ) : expiringSoon.length === 0 ? (
        <p className="muted">No active leases expire in the next 12 months.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Lease</th>
                <th>Tenant</th>
                <th>Premises</th>
                <th>Expires</th>
                <th>Days left</th>
              </tr>
            </thead>
            <tbody>
              {expiringSoon.map((t) => {
                const days = daysFromToday(t.expiration!)
                return (
                  <tr key={t.main.id}>
                    <td>
                      <Link to={`/leases/${t.main.id}`} className="doc-title panel-link">{t.main.title}</Link>
                      {t.renewed && <span className="badge badge-success badge-inline">Renewed</span>}
                    </td>
                    <td>{t.main.tenant ?? '—'}</td>
                    <td>{t.main.premises ?? '—'}</td>
                    <td className="nowrap">{t.expiration!.toLocaleDateString()}</td>
                    <td className={`nowrap${days <= 90 ? ' error' : ''}`}>{days}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="section-title">Documents</h2>
      <Tiles tiles={documentTiles} />
    </main>
  )
}
