/**
 * Spike: the editor as an MCP App view, talking JSON-RPC over postMessage to the host that holds
 * it, as page-view.html does. Replies are not awaited: nothing here depends on one.
 */
let nextId = 1
export function hostRequest(method: string, params: unknown) {
  window.parent.postMessage({ jsonrpc: '2.0', id: nextId++, method, params }, '*')
}
