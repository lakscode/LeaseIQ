import { useAuth } from '../lib/AuthProvider'

export function Dashboard() {
  const { session } = useAuth()
  const user = session?.user

  return (
    <main className="container">
      <h1>Dashboard</h1>
      <div className="card">
        <p>You are signed in as <strong>{user?.email}</strong>.</p>
        <p className="muted">User ID: {user?.id}</p>
      </div>
    </main>
  )
}
