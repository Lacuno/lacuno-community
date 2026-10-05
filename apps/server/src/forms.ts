import { getConnInfo } from '@hono/node-server/conninfo'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { Send } from './mail.js'

/** The published site a form was sent from: its public origin and who gets its messages. */
export type FormSite = { origin: string; owner: string; testing: boolean }

const refused = { error: "This form couldn't be sent." }
const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`)

/**
 * `POST /_lacuno/forms`: a visitor's message, mailed to the site's owner and never stored. Bots
 * get the answer people do: a filled honeypot, or a post without the script's time on the page or
 * within three seconds of loading it, is answered as sent.
 */
export function formRoute(send: Send | undefined, site: (url: URL) => FormSite | undefined) {
  const app = new Hono()
  /** When each visitor's accepted posts arrived, by IP and site, for the last ten minutes. */
  const recent = new Map<string, number[]>()
  app.post(
    '/_lacuno/forms',
    bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json(refused, 400) }),
    async (c) => {
      const url = new URL(c.req.url)
      const target = site(url)
      if (!target) return c.notFound()
      if (
        c.req.header('content-type')?.split(';')[0]?.trim() !== 'application/x-www-form-urlencoded'
      )
        return c.json(refused, 400)
      const body = new URLSearchParams(await c.req.text())
      const elapsed = Number(body.get('_lacuno_elapsed') || Number.NaN)
      if (body.get('_lacuno_hp') || !(elapsed >= 3000)) return c.json({ ok: true })
      const fields = [...body].filter(([name]) => !name.startsWith('_lacuno_'))
      if (
        fields.length > 30 ||
        fields.some(([name, value]) => !name || name.length > 100 || value.length > 5000) ||
        !fields.some(([, value]) => value.trim())
      )
        return c.json(refused, 400)
      // A proxy in front appends the address it was reached from.
      const ip =
        c.req.header('x-forwarded-for')?.split(',').pop()?.trim() || getConnInfo(c).remote.address
      const now = Date.now()
      for (const [key, times] of recent) {
        const kept = times.filter((time) => now - time < 10 * 60 * 1000)
        if (kept.length) recent.set(key, kept)
        else recent.delete(key)
      }
      const key = `${ip} ${target.origin}`
      const times = recent.get(key) ?? []
      if (times.length >= 5)
        return c.json({ error: 'Too many messages. Please try again later.' }, 429)
      recent.set(key, [...times, now])
      const form = body.get('_lacuno_form') || 'Contact form'
      const referer = URL.parse(c.req.header('referer') ?? '')
      const page = referer?.origin === target.origin ? referer.href : undefined
      const facts = fields.map(([name, value]) => [name, value.trim() || '—'] as const)
      const replyTo = fields.find(([, value]) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))?.[1]
      const rows = facts
        .map(
          ([name, value]) =>
            `<tr><th align="left" valign="top">${escapeHtml(name)}</th><td style="white-space:pre-wrap">${escapeHtml(value)}</td></tr>`,
        )
        .join('')
      try {
        if (!send) throw new Error('Mail is not configured')
        await send({
          to: target.owner,
          subject: `${target.testing ? '[Testing] ' : ''}New message: ${form} on ${url.hostname}`,
          text: [
            ...facts.map(([name, value]) => `${name}: ${value}`),
            ...(page ? ['', `Page: ${page}`] : []),
          ].join('\n'),
          html: `<table>${rows}</table>${page ? `<p>Page: <a href="${escapeHtml(page)}">${escapeHtml(page)}</a></p>` : ''}`,
          ...(replyTo ? { replyTo } : {}),
        })
      } catch (error) {
        console.error('A form message was not sent:', error)
        return c.json({ error: "Your message couldn't be sent. Please try again later." }, 503)
      }
      return c.json({ ok: true })
    },
  )
  return app
}
