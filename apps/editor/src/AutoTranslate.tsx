import {
  type Document,
  languageName,
  onPage,
  plainText,
  translationKeys,
  translationStatus,
} from '@lacuno/schema'
import { useCallback, useEffect, useState } from 'react'
import { AskAi } from './AskAi.js'
import { api, message, useConfig } from './api.js'
import { Dialog, ErrorNote } from './Dialog.js'
import './publishing.css'

/** What a language and, optionally, one page of it are to be translated. */
export type TranslateRequest = { locale: string; page?: string }

type Status = { available: boolean; upgradeUrl?: string; reason?: string }
type Job = {
  id: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  done: number
  total: number
  error?: string
}
type Scope = 'page' | 'missing' | 'all'

/**
 * The auto-translate service the server names, if any, and what it says of this site: read once
 * per editor, and again by `refresh`. A service that cannot be asked is not available.
 */
export function useAutoTranslate(siteId: string) {
  const url = useConfig().config?.autoTranslate
  const [status, setStatus] = useState<Status>()
  const [reads, setReads] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `reads` asks again.
  useEffect(() => {
    if (!url) return
    api<Status>(`${url}/status?site=${encodeURIComponent(siteId)}`).then(setStatus, (error) => {
      console.error('The auto-translate service did not answer:', error)
      setStatus({ available: false })
    })
  }, [url, siteId, reads])
  const refresh = useCallback(() => setReads((n) => n + 1), [])
  return { url, status, refresh }
}

/** The prompt for the designer's own AI app; ids only, as names are the site's content. */
export const translatePrompt = (site: string, locale: string, page?: string) =>
  `In Lacuno, on site ${site}, translate ${page ? `page ${page}` : 'the site'} into ${languageName(locale)} (${locale}): use translations.list${page ? ` with page ${page}` : ''} and translations.apply, following the site's glossary and tone (guide translate). Check the result with page.preview, then tell me what you translated and what you left.`

/** The values a scope covers and their words: the source text, as a translator counts it. */
function measure(doc: Document, locale: string, scope: Scope, page?: string) {
  let values = 0
  let words = 0
  for (const item of translationKeys(doc)) {
    const status = translationStatus(doc, locale, item.key)
    if (status === 'done' || (scope === 'missing' && status !== 'missing')) continue
    if (scope === 'page' && !(page && onPage(doc, item, page))) continue
    values++
    if (item.kind === 'asset') continue
    const text = item.kind === 'richtext' ? plainText(item.value) : String(item.value)
    words += text.split(/\s+/).filter(Boolean).length
  }
  return { values, words }
}

/**
 * Auto-translate a language: with a service that offers it, choose what, start a job and follow
 * it; with one that does not, say so; without one, translate with your own AI.
 */
export function AutoTranslate({
  siteId,
  doc,
  request: { locale, page },
  service: { url, status },
  connect,
  translated,
  close,
}: {
  siteId: string
  doc: Document
  request: TranslateRequest
  service: { url?: string | undefined; status?: Status | undefined }
  connect: () => void
  /** A finished job's line for the Translations panel. */
  translated: (line: string) => void
  close: () => void
}) {
  const [own, setOwn] = useState(!url)
  const [scope, setScope] = useState<Scope>(page ? 'page' : 'missing')
  const [job, setJob] = useState<Job>()
  const [issue, setIssue] = useState('')
  const name = languageName(locale)
  const running = job?.status === 'queued' || job?.status === 'running'
  const follow = (next: Job) => {
    if (next.status === 'done') {
      translated(`Translated ${next.total} ${next.total === 1 ? 'value' : 'values'} into ${name}.`)
      close()
    } else if (next.status === 'cancelled') close()
    else setJob(next)
  }
  // Every answer is a new job, which asks again 2 s later; live edits re-render in between.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new answer restarts the wait.
  useEffect(() => {
    if (!running) return
    const poll = setTimeout(() => {
      api<{ job: Job }>(`${url}/jobs/${job.id}`).then(
        (answer) => follow(answer.job),
        (error) => setIssue(message(error)),
      )
    }, 2000)
    return () => clearTimeout(poll)
  }, [job])
  if (own)
    return (
      <AskAi
        title="Translate with your own AI"
        prompt={translatePrompt(siteId, locale, page)}
        lead="Connect Claude, ChatGPT or another AI app to this site and paste this prompt."
        connect={connect}
        close={close}
      />
    )
  // Asked when the editor opened; the dialog waits for the answer.
  if (!status) return null
  if (!status.available)
    return (
      <Dialog title="Auto-translate is not available" className="publish-dialog" close={close}>
        {status.reason && <p>{status.reason}</p>}
        <div className="ask-actions">
          {status.upgradeUrl && (
            <a className="publish-action" href={status.upgradeUrl} target="_blank" rel="noopener">
              Upgrade
            </a>
          )}
          <button type="button" onClick={() => setOwn(true)}>
            Use your own AI
          </button>
        </div>
      </Dialog>
    )
  const start = async () => {
    setIssue('')
    try {
      const answer = await api<{ job: Job }>(`${url}/jobs`, {
        site: siteId,
        locale,
        scope,
        ...(scope === 'page' ? { page } : {}),
      })
      follow(answer.job)
    } catch (error) {
      setIssue(message(error))
    }
  }
  const cancel = async () => {
    try {
      await api(`${url}/jobs/${job!.id}`, {}, undefined, 'DELETE')
      close()
    } catch (error) {
      setIssue(message(error))
    }
  }
  const { values, words } = measure(doc, locale, scope, page)
  const scopes: [Scope, string][] = [
    ...(page ? [['page', `This page: ${doc.pages[page]?.name ?? page}`] as [Scope, string]] : []),
    ['missing', 'Everything missing'],
    ['all', 'Everything missing or outdated'],
  ]
  return (
    <Dialog
      title={`Auto-translate into ${name}`}
      className="publish-dialog auto-translate-dialog"
      close={close}
    >
      {job ? (
        <>
          <progress max={job.total || 1} value={job.done} aria-label="Translated" />
          <p role="status">
            {job.status === 'failed'
              ? `Translation failed: ${job.error ?? 'unknown error'}`
              : `${job.done} / ${job.total} translated`}
          </p>
          {running && (
            <button type="button" onClick={() => void cancel()}>
              Cancel
            </button>
          )}
        </>
      ) : (
        <>
          <fieldset>
            <legend>Translate</legend>
            {scopes.map(([value, label]) => (
              <label key={value} className="check-label">
                <input
                  type="radio"
                  name="scope"
                  checked={scope === value}
                  onChange={() => setScope(value)}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <p role="status">
            {values === 1 ? '1 value' : `${values} values`},{' '}
            {words === 1 ? '1 word' : `${words} words`}
          </p>
          <button
            type="button"
            className="publish-action"
            disabled={!values}
            onClick={() => void start()}
          >
            Translate
          </button>
        </>
      )}
      <ErrorNote message={issue} />
    </Dialog>
  )
}
