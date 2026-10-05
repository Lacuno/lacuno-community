/// <reference lib="dom" />
import { createEmptyDocument, type Document } from '@lacuno/schema'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { plainImageResolver } from '../src/images.js'
import { assembleDocument, render } from '../src/render.js'

/** A page whose root holds the given forms, each with an email field and a button. */
function page(...forms: Record<string, string>[]) {
  const doc: Document = createEmptyDocument()
  const home = Object.values(doc.pages)[0]!
  const add = (id: string, tag: string, parent: string, attrs: Record<string, string>) => {
    doc.nodes[id] = {
      id,
      type: 'element',
      tag,
      parent,
      children: [],
      classes: [],
      attrs: Object.fromEntries(
        Object.entries(attrs).map(([name, value]) => [name, { type: 'static', value }]),
      ),
    }
    doc.nodes[parent]!.children.push(id)
  }
  forms.forEach((attrs, i) => {
    add(`form${i}`, 'form', home.root, attrs)
    add(`email${i}`, 'input', `form${i}`, { name: 'email' })
    add(`send${i}`, 'button', `form${i}`, { type: 'submit' })
  })
  return (annotateNodes = false) =>
    render(doc, home, undefined, { resolveImage: plainImageResolver, annotateNodes })
}

it('turns a form without an action into a Lacuno form with one script per page', () => {
  const { body } = page({ 'data-lacuno-form': 'Call <back>' }, {})()
  expect(body).toContain(
    '<form action="/_lacuno/forms" data-lacuno-form="Call &lt;back&gt;" method="post"><input name="email"><button type="submit"></button><div style="position:absolute;left:-10000px" aria-hidden="true"><input name="_lacuno_hp" tabindex="-1" autocomplete="off"></div><input name="_lacuno_form" type="hidden" value="Call &lt;back&gt;"></form>',
  )
  expect(body).toContain('<input name="_lacuno_form" type="hidden" value="Contact form">')
  expect(body.split('<script>').length).toBe(2)
  expect(body).toContain('form[action="/_lacuno/forms"]')
})

it('leaves forms with their own action, pages without forms and the canvas alone', () => {
  const own = page({ action: 'https://list.example/subscribe' })().body
  expect(own).toContain('<form action="https://list.example/subscribe"><input')
  expect(own).not.toContain('_lacuno')
  expect(own).not.toContain('<script>')
  expect(page()().body).not.toContain('<script>')
  const canvas = page({})(true).body
  expect(canvas).not.toContain('_lacuno')
  expect(canvas).not.toContain('<script>')
})

it('posts the form with the time on the page and shows the answer', async () => {
  const html = assembleDocument(page({ 'data-success': 'Got it.' })())
  const browser = await chromium.launch({ headless: true })
  try {
    const tab = await browser.newPage()
    const posts: string[] = []
    let answer = { status: 429, body: '{"error":"Too many messages. Please try again later."}' }
    await tab.route('http://site.test/**', (route) => {
      if (route.request().method() !== 'POST')
        return route.fulfill({ contentType: 'text/html', body: html })
      posts.push(route.request().postData()!)
      return route.fulfill({ contentType: 'application/json', ...answer })
    })
    await tab.goto('http://site.test/')
    await tab.fill('input[name=email]', 'ada@example.com')
    await tab.click('button')
    await expect
      .poll(() => tab.textContent('[role=alert]'))
      .toBe('Too many messages. Please try again later.')
    expect(posts[0]).toMatch(
      /^email=ada%40example\.com&_lacuno_hp=&_lacuno_form=Contact\+form&_lacuno_elapsed=\d+$/,
    )
    expect(await tab.isEnabled('button')).toBe(true)
    answer = { status: 502, body: 'Bad gateway' }
    await tab.click('button')
    await expect.poll(() => posts.length).toBe(2)
    await expect
      .poll(() => tab.textContent('[role=alert]'))
      .toBe("Your message couldn't be sent. Please try again later.")
    expect(await tab.locator('[role=alert]').count()).toBe(1)
    answer = { status: 200, body: '{"ok":true}' }
    await tab.click('button')
    await expect.poll(() => tab.textContent('form')).toBe('Got it.')
  } finally {
    await browser.close()
  }
}, 20000)
