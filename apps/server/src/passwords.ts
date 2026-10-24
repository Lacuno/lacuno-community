import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { type Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { getCookie, setCookie } from 'hono/cookie'
import { clientIp } from './forms.js'
import type { PublicationReader, Target } from './publication-reader.js'

const derive = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  length: number,
) => Promise<Buffer>

/** A password as the database keeps it: `<salt>:<scrypt hash>`, both hex. */
export async function hashPassword(password: string) {
  const salt = randomBytes(16)
  return `${salt.toString('hex')}:${(await derive(password, salt, 32)).toString('hex')}`
}

export async function verifyPassword(password: string, stored: string) {
  const [salt = '', hash = ''] = stored.split(':')
  const expected = Buffer.from(hash, 'hex')
  return timingSafeEqual(await derive(password, Buffer.from(salt, 'hex'), 32), expected)
}

const COOKIE = 'lacuno_access'
const DAYS = 30
type Access = { siteId: string; target: Target; version: number }
const signature = (key: Buffer, access: Access, expires: number) =>
  createHmac('sha256', key)
    .update(`${access.siteId} ${access.target} ${access.version} ${expires}`)
    .digest()

/** The cookie's value, `<expiry in ms>.<signature>`, good for this site, target and version. */
export function signAccess(key: Buffer, access: Access, now = Date.now()) {
  const expires = now + DAYS * 86_400_000
  return `${expires}.${signature(key, access, expires).toString('base64url')}`
}

export function verifyAccess(key: Buffer, value: string | undefined, access: Access) {
  const [expires, signed = ''] = (value ?? '').split('.')
  const time = Number(expires)
  const given = Buffer.from(signed, 'base64url')
  const expected = signature(key, access, time)
  return time > Date.now() && given.length === expected.length && timingSafeEqual(given, expected)
}

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`)

function passwordPage(c: Context, site: string, next: string, error = '', status: 401 | 429 = 401) {
  c.header('Cache-Control', 'private, no-store')
  c.header('X-Robots-Tag', 'noindex, nofollow')
  return c.html(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(site)}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;color:#222;background:#f6f6f7}form{display:grid;gap:12px;width:min(320px,calc(100vw - 32px))}h1{margin:0 0 8px;font-size:22px}input,button{font:inherit;padding:10px 12px;border-radius:6px;border:1px solid #c9c9d0}button{background:#222;color:#fff;border-color:#222;cursor:pointer}p{margin:0;color:#b42318}</style></head><body><form method="post" action="/_lacuno/unlock"><h1>${escapeHtml(site)}</h1><input type="hidden" name="next" value="${escapeHtml(next)}"><input type="password" name="password" aria-label="Password" placeholder="Password" autocomplete="current-password" required autofocus>${error ? `<p role="alert">${error}</p>` : ''}<button type="submit">Continue</button></form></body></html>`,
    status,
  )
}

/**
 * A published site's passwords: a protected target answers its password page, or 401 to a form
 * post, until `POST /_lacuno/unlock` sets a signed cookie. Content-addressed files stay open.
 */
export function accessRoutes(reader: PublicationReader, secret: string) {
  const key = createHmac('sha256', secret).update('lacuno site access').digest()
  const app = new Hono()
  /** When each visitor tried a site's password, by IP and site, for the last minute. */
  const recent = new Map<string, number[]>()
  const locked = (c: Context) => {
    const url = new URL(c.req.url)
    const host = reader.siteForHost(url.hostname)
    const lock = host && reader.password(host.siteId, host.target)
    return host && lock && { url, host, lock, access: { ...host, version: lock.version } }
  }
  app.post('/_lacuno/unlock', bodyLimit({ maxSize: 16 * 1024 }), async (c) => {
    const found = locked(c)
    if (!found) return c.notFound()
    const { url, host, lock, access } = found
    const body = await c.req.parseBody()
    const asked = URL.parse(String(body.next ?? '/'), url.origin)
    const next = asked?.origin === url.origin ? asked.pathname + asked.search : '/'
    const now = Date.now()
    for (const [held, times] of recent) {
      const kept = times.filter((time) => now - time < 60_000)
      if (kept.length) recent.set(held, kept)
      else recent.delete(held)
    }
    const visitor = `${clientIp(c)} ${host.siteId}`
    const times = recent.get(visitor) ?? []
    if (times.length >= 10)
      return passwordPage(c, lock.name, next, 'Too many tries. Please wait a minute.', 429)
    recent.set(visitor, [...times, now])
    if (!(await verifyPassword(String(body.password ?? ''), lock.hash)))
      return passwordPage(c, lock.name, next, 'That password is not right.')
    setCookie(c, COOKIE, signAccess(key, access), {
      httpOnly: true,
      sameSite: 'Lax',
      secure: reader.url(host.siteId, host.target).startsWith('https:'),
      path: '/',
      maxAge: DAYS * 86_400,
    })
    return c.redirect(next, 303)
  })
  app.use('*', async (c, next) => {
    const found = locked(c)
    if (!found || /^\/(?:assets|_astro)\//.test(found.url.pathname)) return next()
    if (verifyAccess(key, getCookie(c, COOKIE), found.access)) {
      await next()
      c.header('Cache-Control', 'private, no-store')
      return
    }
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD')
      return c.json({ error: 'This site needs its password.' }, 401)
    return passwordPage(c, found.lock.name, found.url.pathname + found.url.search)
  })
  return app
}
