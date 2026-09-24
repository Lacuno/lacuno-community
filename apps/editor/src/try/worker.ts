/// <reference lib="webworker" />
import { DocumentStore } from '@freeflow/document'
import template from '../../../../templates/freeflow/freeflow.json'
import { IdbPersistence } from './idb.js'
import { handle } from './routes.js'

declare const self: ServiceWorkerGlobalScope

const persistence = new IdbPersistence(template)
let store: Promise<DocumentStore> | undefined

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('message', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return
  // A store that failed to load is loaded again on the next request.
  store ??= DocumentStore.withPersistence(persistence).catch((error) => {
    store = undefined
    throw error
  })
  event.respondWith(
    handle(event.request, store, persistence).then((response) => response ?? fetch(event.request)),
  )
})
