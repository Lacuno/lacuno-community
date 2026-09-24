/// <reference types="vite/client" />
import type { Document } from '@freeflow/schema'
import { IdbPersistence } from './idb.js'
import worker from './worker.ts?worker&url'

const { serviceWorker } = navigator
const ticket = new URLSearchParams(location.hash.slice(1)).get('import')
if (ticket) {
  // After sign-up the site moves to the new account and leaves this browser.
  const template = await import('../../../../templates/freeflow/freeflow.json')
  const persistence = new IdbPersistence(template.default)
  const site = (await persistence.load()) as Document
  const assets: Record<string, string> = {}
  for (const { hash } of Object.values(site.assets)) {
    const bytes = await persistence.getAsset(hash)
    if (bytes) assets[hash] = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
  }
  const response = await fetch('/_freeflow/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Freeflow-Import': ticket },
    body: JSON.stringify({ name: site.site.name, document: site, assets }),
  }).catch(() =>
    Response.json(
      { error: 'Your site could not be moved. Check your connection and reload.' },
      { status: 503 },
    ),
  )
  const body = await response
    .json()
    .catch(() => ({ error: `Your site could not be moved (${response.status}).` }))
  if (response.ok) {
    // A running worker keeps the old site in memory, so the next visit starts a new one.
    await (await serviceWorker.getRegistration())?.unregister()
    await persistence.delete()
    location.replace(body.redirect)
  } else {
    const message = document.createElement('p')
    message.textContent = body.error
    document.getElementById('root')!.append(message)
  }
} else {
  // The service worker answers the editor's API, so the editor starts once it controls the page.
  // A hard reload bypasses the worker even when it is active, so the page asks it to claim it.
  await serviceWorker.register(worker, { scope: '/' })
  if (!serviceWorker.controller)
    await new Promise((resolve) => {
      serviceWorker.addEventListener('controllerchange', resolve, { once: true })
      void serviceWorker.ready.then((registration) => registration.active?.postMessage('claim'))
    })
  if (!new URLSearchParams(location.search).has('site'))
    history.replaceState(null, '', '/?site=try')
  await import('../main.js')
}
