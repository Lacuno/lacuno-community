import { useEffect, useState } from 'react'
import { ApiError, api, message, useConfig } from './api.js'
import { Consent } from './Consent.js'
import { Editor } from './Editor.js'

const logo = new URL('./logo.svg', import.meta.url).href

type User = { name: string; email: string }
type Site = { id: string; name: string; revision: number }

/** Where the try editor sends a visitor for what needs an account. */
export function SignUpLink() {
  return (
    <a className="signup-link" href="/signup">
      Sign up
    </a>
  )
}

export function Brand() {
  return (
    <span className="brand">
      <img className="brand-logo" src={logo} width={123} height={30} alt="Lacuno" />
      <span className="badge">EARLY ACCESS</span>
    </span>
  )
}

function Auth({ onLogin }: { onLogin: (user: User) => void }) {
  const [signup, setSignup] = useState(false)
  const { config, error: configError } = useConfig()
  const [setupDone, setSetupDone] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const setup = !!config?.setupRequired && !setupDone
  const configured = !!config
  return (
    <main className="auth-layout">
      <div className="auth-intro">
        <Brand />
        <div>
          <p className="eyebrow">YOUR IDEAS. YOUR CANVAS.</p>
          <h1>
            Make something
            <br />
            that feels like you.
          </h1>
          <p>
            A home for your sites, from the first idea
            <br />
            to the last little detail.
          </p>
        </div>
        <span className="muted">Open source. Yours to build.</span>
      </div>
      <div className="auth-form">
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            setBusy(true)
            setError('')
            const data = new FormData(event.currentTarget)
            try {
              const result = await api<{ user: User }>(
                setup ? '/api/setup' : `/api/auth/${signup ? 'sign-up' : 'sign-in'}/email`,
                {
                  email: data.get('email'),
                  password: data.get('password'),
                  ...(signup || setup ? { name: data.get('name') } : {}),
                  ...(setup ? { token: String(data.get('token')).trim() } : {}),
                },
              )
              onLogin(result.user)
            } catch (e) {
              setError(message(e))
              if (setup && e instanceof ApiError && e.status === 409) setSetupDone(true)
            } finally {
              setBusy(false)
            }
          }}
        >
          <p className="eyebrow">LET’S GET STARTED</p>
          <h2>{setup ? 'Set up your Lacuno' : signup ? 'Create your account' : 'Welcome back'}</h2>
          <p className="muted">
            {setup
              ? 'Create your owner account. Registration closes automatically afterward.'
              : signup
                ? 'A workspace for everything you’ll make.'
                : 'Sign in to your Lacuno workspace.'}
          </p>
          {(signup || setup) && (
            <label>
              Your name
              <input name="name" required autoComplete="name" />
            </label>
          )}
          <label>
            Email
            <input name="email" type="email" required autoComplete="email" />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete={signup || setup ? 'new-password' : 'current-password'}
            />
          </label>
          {setup && (
            <>
              <label>
                Setup token
                <input
                  name="token"
                  type="password"
                  required
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby="setup-token-help"
                />
              </label>
              <p className="muted" id="setup-token-help">
                Retrieve your one-time token from the server with <code>pnpm owner:token</code>. For
                Docker, use the token command in the self-hosting guide.
              </p>
            </>
          )}
          {(error || configError) && (
            <p role="alert" className="error">
              {error || configError}
            </p>
          )}
          <button className="primary" disabled={busy || !configured} type="submit">
            {busy
              ? 'Please wait…'
              : !configured
                ? 'Loading…'
                : setup
                  ? 'Create owner account'
                  : signup
                    ? 'Create account'
                    : 'Sign in'}
            <span aria-hidden="true">→</span>
          </button>
          {config?.allowSignup && (
            <button
              className="text-button"
              type="button"
              disabled={busy}
              onClick={() => {
                setSignup(!signup)
                setError('')
              }}
            >
              {signup ? 'Already have an account? Sign in' : 'New here? Create an account'}
            </button>
          )}
        </form>
      </div>
    </main>
  )
}

function Sites({
  user,
  open,
  logout,
}: {
  user: User
  open: (id: string) => void
  logout: () => void
}) {
  const [sites, setSites] = useState<Site[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // The try editor has its one site and no account to sign out of.
  const trying = useConfig().config?.try
  useEffect(() => {
    api<{ sites: Site[] }>('/api/sites')
      .then((data) => setSites(data.sites))
      .catch((e) => setError(message(e)))
  }, [])
  return (
    <div className="workspace">
      <header className="workspace-header">
        <Brand />
        <div className="row">
          <span className="muted">{user.name}</span>
          {!trying && (
            <button type="button" onClick={logout}>
              Sign out
            </button>
          )}
        </div>
      </header>
      <main className="sites-main">
        <p className="eyebrow">MY WORKSPACE</p>
        <h1>Your next idea starts here.</h1>
        <p className="muted">Pick up where you left off, or start with a fresh canvas.</p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="site-grid">
          {sites.map((site) => (
            <button type="button" className="site-card" key={site.id} onClick={() => open(site.id)}>
              <div className="site-art">
                <span>
                  {site.name.charAt(0)}
                  <span className="art-dot">.</span>
                </span>
                <div className="art-lines" />
              </div>
              <div className="site-card-caption">
                <strong>{site.name}</strong>
                <span>Open editor ↗</span>
              </div>
            </button>
          ))}
          {!trying && (
            <form
              className="create-card"
              onSubmit={async (event) => {
                event.preventDefault()
                setBusy(true)
                setError('')
                try {
                  const site = await api<Site>('/api/sites', {
                    name: new FormData(event.currentTarget).get('name'),
                  })
                  open(site.id)
                } catch (e) {
                  setError(message(e))
                  setBusy(false)
                }
              }}
            >
              <span className="create-icon">+</span>
              <h2>Start a new site</h2>
              <p className="muted">A complete starter, ready to make your own.</p>
              <label>
                Site name
                <input name="name" required maxLength={200} placeholder="My new site" />
              </label>
              <button type="submit" className="primary" disabled={busy}>
                {busy ? 'Creating…' : 'Create site'}
                <span aria-hidden="true">→</span>
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  )
}

export function App() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [site, setSite] = useState(new URLSearchParams(location.search).get('site') ?? '')
  useEffect(() => {
    api<{ user: User } | null>('/api/auth/get-session')
      .then((session) => setUser(session?.user ?? null))
      .catch((e) => setError(message(e)))
      .finally(() => setLoading(false))
  }, [])
  function open(id: string) {
    setSite(id)
    history.replaceState(null, '', id ? `/?site=${encodeURIComponent(id)}` : '/')
  }
  if (loading) return <div className="loading">Opening your workspace…</div>
  if (error)
    return (
      <div className="loading">
        <p role="alert">{error}</p>
        <button type="button" onClick={() => location.reload()}>
          Try again
        </button>
      </div>
    )
  if (!user) return <Auth onLogin={setUser} />
  if (location.pathname === '/consent') return <Consent />
  if (site) return <Editor siteId={site} back={() => open('')} />
  return (
    <Sites
      user={user}
      open={open}
      logout={() => {
        api<{ redirectURL?: string }>('/api/auth/sign-out', {})
          .then((result) => {
            if (result.redirectURL) location.assign(result.redirectURL)
            else setUser(null)
          })
          .catch((e) => setError(message(e)))
      }}
    />
  )
}
