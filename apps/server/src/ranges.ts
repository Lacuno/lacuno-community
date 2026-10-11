import type { Context } from 'hono'

/**
 * A file's body, or the part a single `Range: bytes=…` asks for. Browsers seek a video only in a
 * file served this way: Chromium treats one served whole as a stream it cannot seek.
 */
export function rangedBody(c: Context, bytes: Uint8Array<ArrayBuffer>) {
  c.header('Accept-Ranges', 'bytes')
  const [, from = '', to = ''] = /^bytes=(\d*)-(\d*)$/.exec(c.req.header('range') ?? '') ?? []
  if (!from && !to) return c.body(bytes)
  const size = bytes.length
  const start = from ? Number(from) : Math.max(0, size - Number(to))
  const end = from && to ? Math.min(Number(to), size - 1) : size - 1
  if (start > end) {
    c.header('Content-Range', `bytes */${size}`)
    return c.body(null, 416)
  }
  c.header('Content-Range', `bytes ${start}-${end}/${size}`)
  return c.body(bytes.subarray(start, end + 1), 206)
}
