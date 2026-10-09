import { InputError } from '@lacuno/mcp/errors'
import { imageInfo, render } from '@lacuno/mcp/screenshot'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { type Browser, chromium } from 'playwright'
import { z } from 'zod'

// A desktop or phone viewport; larger ones cost memory every other request in the queue waits for.
const Options = z.strictObject({
  width: z.number().int().positive().max(2560),
  height: z.number().int().positive().max(2560).optional(),
  node: z.string().optional(),
  maxHeight: z.number().int().positive().max(16384).optional(),
  boxes: z.literal(true).optional(),
})
/** Chromium is relaunched after this many screenshots, which keeps its memory flat. */
const SHOTS_PER_BROWSER = 200

type Launched = { browser: Promise<Browser>; shots: number; open: number }

/**
 * page.screenshot for runtimes without Chromium. `POST /screenshot` takes multipart `request`
 * (`{ width, height?, node?, maxHeight?, boxes? }`), `html` and an `asset:<path>` part per asset
 * the page uses, and answers a JPEG of the page or a PNG of the node, rendered in a fresh context
 * of one shared Chromium; with `boxes`, JSON `{ image, mime, boxes }` with the image in base64. At
 * most `slots` render at once; a request that waits longer than `wait` ms for one is answered 503.
 */
export function screenshotService({
  slots,
  secret,
  wait,
}: {
  slots: number
  secret: string | undefined
  wait: number
}) {
  let free = slots
  const queue: (() => void)[] = []
  /** Resolves to whether a slot was taken within `wait`. */
  const take = () =>
    new Promise<boolean>((resolve) => {
      if (free > 0) {
        free--
        return resolve(true)
      }
      const next = () => {
        clearTimeout(timer)
        resolve(true)
      }
      const timer = setTimeout(() => {
        queue.splice(queue.indexOf(next), 1)
        resolve(false)
      }, wait)
      queue.push(next)
    })
  const release = () => {
    const next = queue.shift()
    if (next) next()
    else free++
  }

  let current: Launched | undefined
  const launch = (): Launched => {
    const launched: Launched = { browser: chromium.launch(), shots: 0, open: 0 }
    // A crashed or failed Chromium is replaced on the next request.
    const forget = () => {
      if (current === launched) current = undefined
    }
    launched.browser.then((browser) => browser.on('disconnected', forget), forget)
    return launched
  }
  current = launch()

  const app = new Hono()
  app.get('/health', (c) => c.text('ok'))
  app.post(
    '/screenshot',
    bodyLimit({
      maxSize: 30 * 1024 * 1024,
      onError: (c) => c.json({ error: 'The page and its assets are over 30 MB.' }, 413),
    }),
    async (c) => {
      if (secret && c.req.header('authorization') !== `Bearer ${secret}`)
        return c.json({ error: 'Unauthorized' }, 401)
      let form: FormData
      let html: string
      let options: z.infer<typeof Options>
      try {
        form = await c.req.formData()
        html = z.string().parse(form.get('html'))
        options = Options.parse(JSON.parse(String(form.get('request'))))
      } catch {
        return c.json({ error: 'Send request and html as multipart/form-data.' }, 400)
      }
      if (!(await take())) return c.json({ error: 'Screenshots are busy.', retryAfter: 5 }, 503)
      current ??= launch()
      const launched = current
      if (++launched.shots >= SHOTS_PER_BROWSER) current = undefined
      launched.open++
      try {
        const shot = await render(
          await launched.browser,
          html,
          async (path) => {
            const file = form.get(`asset:${path}`)
            return file instanceof File
              ? { mime: file.type, body: Buffer.from(await file.arrayBuffer()) }
              : undefined
          },
          options,
        )
        if (Buffer.isBuffer(shot))
          return c.body(new Uint8Array(shot), 200, { 'content-type': imageInfo(shot).mime })
        return c.json({
          image: shot.image.toString('base64'),
          mime: imageInfo(shot.image).mime,
          boxes: shot.boxes,
        })
      } catch (e) {
        if (e instanceof InputError) return c.json({ error: e.message }, 400)
        throw e
      } finally {
        release()
        // A replaced Chromium closes once its last screenshot is done.
        if (--launched.open === 0 && current !== launched)
          launched.browser.then((browser) => browser.close()).catch(() => {})
      }
    },
  )
  return app
}
