import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthProvider'
import { supabase } from '../lib/supabase'

type Stats = {
  files: number
  documents: number
  mainLeases: number
  amendments: number
  addenda: number
  commencementLetters: number
  otherChildren: number
  scanned: number
}

async function countRows(table: 'lease_files' | 'leases', filter?: (q: any) => any) {
  let query = supabase.from(table).select('*', { count: 'exact', head: true })
  if (filter) query = filter(query)
  const { count, error } = await query
  if (error) throw new Error(error.message)
  return count ?? 0
}

export function Dashboard() {
  const { session } = useAuth()
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      countRows('lease_files'),
      countRows('leases'),
      countRows('leases', (q) => q.eq('doc_type', 'main_lease')),
      countRows('leases', (q) => q.eq('doc_type', 'amendment')),
      countRows('leases', (q) => q.eq('doc_type', 'addendum')),
      countRows('leases', (q) => q.eq('doc_type', 'commencement_letter')),
      countRows('leases', (q) => q.eq('doc_type', 'other')),
      countRows('lease_files', (q) => q.eq('is_scanned', true)),
    ]).then(
      ([files, documents, mainLeases, amendments, addenda, commencementLetters, otherChildren, scanned]) =>
        setStats({ files, documents, mainLeases, amendments, addenda, commencementLetters, otherChildren, scanned }),
      (e) => setError(e.message),
    )
  }, [])

  const tiles: Array<[string, number | undefined, string?]> = [
    ['Files uploaded', stats?.files, stats ? `${stats.scanned} scanned (OCR)` : undefined],
    ['Lease documents', stats?.documents, 'All documents found in uploads'],
    ['Main leases', stats?.mainLeases],
    ['Amendments', stats?.amendments],
    ['Addenda', stats?.addenda],
    ['Commencement letters', stats?.commencementLetters],
    ['Other documents', stats?.otherChildren, 'Assignments, guaranties, SNDAs…'],
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

      <section className="stats">
        {tiles.map(([label, value, hint]) => (
          <div key={label} className="card stat">
            <div className="stat-label">{label}</div>
            <div className="stat-value">{value ?? '…'}</div>
            {hint && <div className="muted small">{hint}</div>}
          </div>
        ))}
      </section>
    </main>
  )
}
