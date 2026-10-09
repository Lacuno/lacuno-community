import type { Page } from '@lacuno/schema'
import { useId, useState } from 'react'
import { Dialog } from './Dialog.js'
import './publishing.css'

/** Where the element is and what to fix on it, in words an AI app with the site connected can act on. */
const prompt = (site: string, page: Page, label: string, id: string) =>
  `In Lacuno, on the site "${site}", open the page "${page.name}" (${page.path}) and look at the ${label} (element ${id}). Fix what looks off: align it with its neighbours, make its spacing match the rest of the page, and keep the text readable at phone width. Keep the change small, check it with a screenshot, then tell me what you changed.`

/**
 * A ready-made prompt about the selected element for the designer's own AI app. Lacuno calls no
 * model: the text opens prefilled in claude.ai or ChatGPT, or is copied for any other app.
 */
export function AskAi({
  site,
  page,
  label,
  id,
  close,
}: {
  site: string
  page: Page
  label: string
  id: string
  close: () => void
}) {
  const [text, setText] = useState(() => prompt(site, page, label, id))
  const [status, setStatus] = useState('')
  const field = useId()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setStatus('Prompt copied.')
    } catch {
      setStatus('Could not copy. Select the text and copy it yourself.')
    }
  }
  const encoded = encodeURIComponent(text)
  return (
    <Dialog
      title={`Ask your AI about ${label}`}
      className="publish-dialog ask-dialog"
      closeName="Close ask your AI"
      close={close}
    >
      <label htmlFor={field}>Prompt</label>
      <textarea
        id={field}
        rows={7}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="ask-actions">
        <a href={`https://claude.ai/new?q=${encoded}`} target="_blank" rel="noopener">
          Open in claude.ai
        </a>
        <a href={`https://chatgpt.com/?q=${encoded}`} target="_blank" rel="noopener">
          Open in ChatGPT
        </a>
        <button type="button" onClick={() => void copy()}>
          Copy prompt
        </button>
      </div>
      <p role="status" className="connect-status">
        {status}
      </p>
      <p className="hint">Your AI needs Lacuno connected: see Connect your AI.</p>
    </Dialog>
  )
}
