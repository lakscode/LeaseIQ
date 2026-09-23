import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    if (error) setError(error.message)
    else setSent(true)
    setLoading(false)
  }

  return (
    <main className="center">
      <form className="card auth-card" onSubmit={handleSubmit}>
        <h2>Reset your password</h2>

        {sent ? (
          <p className="success">
            If an account exists for {email}, a password reset link is on its way. Check your inbox.
          </p>
        ) : (
          <>
            <p className="muted">Enter your email and we will send you a link to reset your password.</p>
            <label>
              Email
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>

            {error && <p className="error">{error}</p>}

            <button className="btn" type="submit" disabled={loading}>
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
          </>
        )}

        <p className="muted">
          <Link to="/login" className="link">Back to log in</Link>
        </p>
      </form>
    </main>
  )
}
