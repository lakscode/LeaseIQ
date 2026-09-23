import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthProvider'

export function Landing() {
  const { session } = useAuth()

  return (
    <main>
      <section className="hero">
        <h1>Build faster with Supabase</h1>
        <p>A starter app with authentication, a landing page, and a protected dashboard.</p>
        <Link to={session ? '/dashboard' : '/login'} className="btn btn-lg">
          {session ? 'Go to dashboard' : 'Get started'}
        </Link>
      </section>

      <section className="features">
        <div className="card">
          <h3>🔐 Authentication</h3>
          <p>Email and password sign-up and login powered by Supabase Auth.</p>
        </div>
        <div className="card">
          <h3>🛡️ Protected routes</h3>
          <p>Pages that only signed-in users can see.</p>
        </div>
        <div className="card">
          <h3>⚡ Vite + React</h3>
          <p>Fast dev server and TypeScript out of the box.</p>
        </div>
      </section>
    </main>
  )
}
