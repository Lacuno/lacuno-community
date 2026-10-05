import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createServer } from '../src/app.js'
import { openDatabase } from '../src/database.js'
import type { Mail } from '../src/mail.js'

const origin = 'http://localhost:3000'
const sent: Mail[] = []
let fail = false
let dir = ''
let server: Awaited<ReturnType<typeof createServer>>
let site = ''

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'lacuno-forms-'))
  server = await createServer({
    dataDir: dir,
    templateDir: fileURLToPath(new URL('../../../templates/lacuno', import.meta.url)),
    baseURL: origin,
    publishBaseURL: 'http://localhost:3001',
    secret: 'forms-test-secret-4c9e1a7b2d8f3e6a5b0c',
    allowSignup: true,
    mail: async (mail) => {
      if (fail) throw new Error('SMTP is down')
      sent.push(mail)
    },
  })
  const headers = { origin, 'content-type': 'application/json' }
  const signUp = await server.app.request(`${origin}/api/auth/sign-up/email`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'Owner',
      email: 'owner@example.test',
      password: 'forms-password',
    }),
  })
  const cookie = signUp.headers.getSetCookie()[0]!.split(';')[0]!
  const created = await server.app.request(`${origin}/api/sites`, {
    method: 'POST',
    headers: { ...headers, cookie },
    body: JSON.stringify({ name: 'Forms' }),
  })
  site = ((await created.json()) as { id: string }).id
  // Publications as a release leaves them, without building one.
  const { sqlite } = openDatabase(dir)
  sqlite.pragma('foreign_keys = OFF')
  for (const target of ['production', 'testing'])
    sqlite.prepare('INSERT INTO publications VALUES (?, ?, ?)').run(site, target, randomUUID())
  sqlite.close()
})
afterAll(async () => {
  server.close()
  await rm(dir, { recursive: true, force: true })
})

const valid = { name: 'Ada', email: 'ada@example.com', message: 'Hello\nthere' }
let ip = 0
/** A post from a new visitor unless `from` names one, as the form script sends it. */
function post(
  fields: Record<string, string> = valid,
  {
    host = `${site}.localhost`,
    from = `203.0.113.${++ip}`,
    ...headers
  }: Record<string, string> = {},
  extra: Record<string, string> = {
    _lacuno_hp: '',
    _lacuno_form: 'Contact',
    _lacuno_elapsed: '4000',
  },
) {
  return server.published!.request(`http://${host}:3001/_lacuno/forms`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'x-forwarded-for': `198.51.100.7, ${from}`,
      ...headers,
    },
    body: new URLSearchParams({ ...fields, ...extra }),
  })
}
const answer = async (response: Response) => [response.status, await response.json()]

it('says forms work when the server sends mail', async () => {
  expect(await (await server.app.request(`${origin}/api/config`)).json()).toMatchObject({
    forms: true,
  })
})

it('mails the message to the site owner, replying to the visitor', async () => {
  sent.length = 0
  const page = `http://${site}.localhost:3001/contact`
  expect(await answer(await post(valid, { referer: page }))).toEqual([200, { ok: true }])
  expect(sent).toEqual([
    {
      to: 'owner@example.test',
      subject: `New message: Contact on ${site}.localhost`,
      text: `name: Ada\nemail: ada@example.com\nmessage: Hello\nthere\n\nPage: ${page}`,
      html: `<table><tr><th align="left" valign="top">name</th><td style="white-space:pre-wrap">Ada</td></tr><tr><th align="left" valign="top">email</th><td style="white-space:pre-wrap">ada@example.com</td></tr><tr><th align="left" valign="top">message</th><td style="white-space:pre-wrap">Hello\nthere</td></tr></table><p>Page: <a href="${page}">${page}</a></p>`,
      replyTo: 'ada@example.com',
    },
  ])
})

it('marks testing, escapes HTML, shows empty fields and ignores other pages and no address', async () => {
  sent.length = 0
  await post(
    { topic: '<b>Hi</b>', phone: '', note: 'not@mail' },
    { host: `${site}-testing.localhost`, referer: 'https://elsewhere.example/' },
    { _lacuno_elapsed: '3000' },
  )
  expect(sent[0]).toEqual({
    to: 'owner@example.test',
    subject: `[Testing] New message: Contact form on ${site}-testing.localhost`,
    text: 'topic: <b>Hi</b>\nphone: —\nnote: not@mail',
    html: expect.stringContaining(
      '<td style="white-space:pre-wrap">&#60;b&#62;Hi&#60;/b&#62;</td>',
    ),
  })
})

it('answers bots as if sent and sends nothing', async () => {
  sent.length = 0
  for (const extra of [
    { _lacuno_hp: 'https://spam.example', _lacuno_elapsed: '9000' },
    { _lacuno_elapsed: '2999' },
    { _lacuno_elapsed: 'soon' },
    {},
  ])
    expect(await answer(await post(valid, {}, extra))).toEqual([200, { ok: true }])
  expect(sent).toEqual([])
})

it('refuses malformed posts', async () => {
  sent.length = 0
  const refused = [400, { error: "This form couldn't be sent." }]
  const many = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`f${i}`, 'x']))
  for (const fields of [
    many,
    { ['n'.repeat(101)]: 'x' },
    { message: 'x'.repeat(5001) },
    { name: ' ', email: '' },
    // Over 64 KB, each value within its limit.
    Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`f${i}`, 'x'.repeat(5000)])),
  ])
    expect(await answer(await post(fields))).toEqual(refused)
  expect(await answer(await post(valid, { 'content-type': 'application/json' }))).toEqual(refused)
  const thirty = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`f${i}`, 'x']))
  expect((await post(thirty)).status).toBe(200)
  expect(sent).toHaveLength(1)
})

it('limits each visitor to five messages a site in ten minutes', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    for (let i = 0; i < 5; i++) expect((await post(valid, { from: '192.0.2.1' })).status).toBe(200)
    expect(await answer(await post(valid, { from: '192.0.2.1' }))).toEqual([
      429,
      { error: 'Too many messages. Please try again later.' },
    ])
    expect((await post(valid, { from: '192.0.2.2' })).status).toBe(200)
    expect(
      (await post(valid, { from: '192.0.2.1', host: `${site}-testing.localhost` })).status,
    ).toBe(200)
    vi.advanceTimersByTime(10 * 60 * 1000)
    expect((await post(valid, { from: '192.0.2.1' })).status).toBe(200)
  } finally {
    vi.useRealTimers()
  }
})

it('tells the visitor to try again when the mail fails or is off', async () => {
  const unsent = [503, { error: "Your message couldn't be sent. Please try again later." }]
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  fail = true
  expect(await answer(await post())).toEqual(unsent)
  fail = false
  const silent = await createServer({
    dataDir: dir,
    templateDir: fileURLToPath(new URL('../../../templates/lacuno', import.meta.url)),
    baseURL: origin,
    publishBaseURL: 'http://localhost:3001',
    secret: 'forms-test-secret-4c9e1a7b2d8f3e6a5b0c',
  })
  try {
    expect(await (await silent.app.request(`${origin}/api/config`)).json()).toMatchObject({
      forms: false,
    })
    const response = await silent.published!.request(
      `http://${site}.localhost:3001/_lacuno/forms`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-forwarded-for': '192.0.2.9',
        },
        body: new URLSearchParams({ ...valid, _lacuno_elapsed: '5000' }),
      },
    )
    expect(await answer(response)).toEqual(unsent)
  } finally {
    silent.close()
    error.mockRestore()
  }
})

it('knows only published sites', async () => {
  expect((await post(valid, { host: `${randomUUID()}.localhost` })).status).toBe(404)
  expect((await post(valid, { host: 'localhost' })).status).toBe(404)
})
