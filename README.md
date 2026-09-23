# Supabase App

Vite + React + TypeScript starter with Supabase email/password auth.

- `/` — landing page
- `/login` — log in / sign up
- `/dashboard` — protected, signed-in users only
- `/forgot-password` — request a password reset email
- `/reset-password` — set a new password (opened from the reset email link)

## Setup

1. Create a project at https://supabase.com/dashboard.
2. Copy `.env.example` to `.env` and fill in the URL and anon key from **Project Settings → API**.
3. In **Authentication → URL Configuration**, set the Site URL to `http://localhost:5173`
   and add `http://localhost:5173/**` to **Redirect URLs** (needed for the password reset link).
4. Run:

```bash
npm install
npm run dev
```

By default Supabase requires email confirmation on sign-up. Turn it off under
**Authentication → Providers → Email** if you want instant login during development.
