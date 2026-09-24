/// <reference types="vite/client" />
import worker from './worker.ts?worker&url'

// The service worker answers the editor's API, so the editor starts once it controls the page.
// A hard reload bypasses the worker even when it is active, so the page asks it to claim it.
const { serviceWorker } = navigator
await serviceWorker.register(worker, { scope: '/' })
if (!serviceWorker.controller)
  await new Promise((resolve) => {
    serviceWorker.addEventListener('controllerchange', resolve, { once: true })
    void serviceWorker.ready.then((registration) => registration.active?.postMessage('claim'))
  })
if (!new URLSearchParams(location.search).has('site')) history.replaceState(null, '', '/?site=try')
await import('../main.js')
