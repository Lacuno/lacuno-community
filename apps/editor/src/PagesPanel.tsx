import type { Operation } from '@freeflow/document'
import type { Document, Page } from '@freeflow/schema'
import { useState } from 'react'
import { CodeField } from './CodeField.js'
import { Dialog, ErrorNote } from './Dialog.js'
import { EditorIcon } from './EditorIcon.js'
import { canonicalError, duplicatePage, langError, pagePathError, pageSeo } from './pages.js'
import { codeInfo, ImageChoice, SiteSettings } from './SiteSettings.js'

export function PagesPanel({
  doc,
  siteId,
  selected,
  disabled,
  choose,
  save,
  autoSave,
}: {
  doc: Document
  siteId: string
  selected: string
  disabled: boolean
  choose: (id: string) => void
  save: (operations: Operation[]) => Promise<boolean>
  autoSave: (operations: Operation[]) => Promise<boolean>
}) {
  const [editing, setEditing] = useState<Page | 'new' | 'site'>()
  return (
    <>
      <div className="panel-title">
        Pages<span>{Object.keys(doc.pages).length}</span>
      </div>
      <div className="pages-toolbar">
        <button type="button" disabled={disabled} onClick={() => setEditing('new')}>
          New page
        </button>
        <button type="button" disabled={disabled} onClick={() => setEditing('site')}>
          <EditorIcon name="settings" />
          Site settings
        </button>
      </div>
      <div className="page-list">
        {Object.values(doc.pages)
          .sort(
            (a, b) =>
              Number(b.path === '/') - Number(a.path === '/') || a.name.localeCompare(b.name),
          )
          .map((page) => (
            <div className="page-row" key={page.id}>
              <button
                type="button"
                className={`page-link ${selected === page.id ? 'active' : ''}`}
                onClick={() => choose(page.id)}
              >
                <EditorIcon name="page" />
                {page.name}
                {page.path === '/404' ? (
                  <span className="badge">Not found</span>
                ) : (
                  <span className="page-path">{page.collection ? 'CMS' : page.path}</span>
                )}
              </button>
              <button
                type="button"
                className="page-settings-trigger"
                aria-label={`Settings for ${page.name}`}
                title="Page settings"
                disabled={disabled}
                onClick={() => {
                  setEditing(page)
                }}
              >
                •••
              </button>
            </div>
          ))}
      </div>
      {editing === 'site' && (
        <SiteSettings
          doc={doc}
          siteId={siteId}
          close={() => setEditing(undefined)}
          autoSave={autoSave}
        />
      )}
      {editing && editing !== 'site' && (
        <PageSettings
          doc={doc}
          siteId={siteId}
          page={editing === 'new' ? undefined : editing}
          disabled={disabled}
          close={() => setEditing(undefined)}
          save={save}
          choose={choose}
        />
      )}
    </>
  )
}

function PageSettings({
  doc,
  siteId,
  page,
  disabled,
  close,
  save,
  choose,
}: {
  doc: Document
  siteId: string
  page?: Page | undefined
  disabled: boolean
  close: () => void
  save: (operations: Operation[]) => Promise<boolean>
  choose: (id: string) => void
}) {
  const [name, setName] = useState(page?.name ?? '')
  const [path, setPath] = useState(page?.path ?? '')
  const [lang, setLang] = useState(page?.lang ?? '')
  const [title, setTitle] = useState(page?.seo?.title ?? '')
  const [description, setDescription] = useState(page?.seo?.description ?? '')
  const [canonical, setCanonical] = useState(page?.seo?.canonical ?? '')
  const [noindex, setNoindex] = useState(page?.seo?.noindex ?? false)
  const [ogImage, setOgImage] = useState(page?.seo?.ogImage ?? '')
  const [headCode, setHeadCode] = useState(page?.headCode ?? '')
  const [bodyCode, setBodyCode] = useState(page?.bodyCode ?? '')
  const [notFound, setNotFound] = useState(false)
  const hasNotFound = Object.values(doc.pages).some((other) => other.path === '/404')
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const run = async (operations: Operation[], id?: string) => {
    if (await save(operations)) {
      close()
      if (id) choose(id)
    } else setError('Could not save page changes. Check the editor message and try again.')
  }
  return (
    <Dialog
      title={page ? 'Page settings' : 'New page'}
      className="page-settings-dialog"
      disabled={disabled}
      close={close}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const issue = !name.trim()
            ? 'Enter a page name.'
            : pagePathError(doc, path.trim(), page?.id) ||
              langError(lang.trim()) ||
              canonicalError(canonical.trim())
          if (issue) {
            setError(issue)
            return
          }
          const seo = pageSeo(page, {
            title: title.trim(),
            description: description.trim(),
            canonical: canonical.trim(),
            noindex,
            ogImage,
          })
          if (page)
            void run([
              {
                type: 'page.update',
                id: page.id,
                name: name.trim(),
                path: path.trim(),
                lang: lang.trim() || null,
                seo,
                headCode: headCode || null,
                bodyCode: bodyCode || null,
              },
            ])
          else {
            const id = `p-${crypto.randomUUID()}`
            void run(
              [
                {
                  type: 'page.create',
                  id,
                  name: name.trim(),
                  path: path.trim(),
                  lang: lang.trim() || undefined,
                  seo,
                  headCode: headCode || undefined,
                  bodyCode: bodyCode || undefined,
                  root: {
                    id: `n-${crypto.randomUUID()}`,
                    type: 'element',
                    tag: 'main',
                    classes: [],
                    children: [],
                  },
                },
              ],
              id,
            )
          }
        }}
      >
        {!page && (
          <label
            className="check-label"
            title={hasNotFound ? 'This site already has a not-found page.' : undefined}
          >
            <input
              type="checkbox"
              checked={notFound}
              disabled={disabled || hasNotFound}
              onChange={(event) => {
                setNotFound(event.target.checked)
                setName(event.target.checked ? 'Not found' : '')
                setPath(event.target.checked ? '/404' : '')
              }}
            />
            Not found page
          </label>
        )}
        <label>
          Page name
          <input
            required
            value={name}
            disabled={disabled || notFound}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          URL path
          <input
            required
            value={path}
            disabled={disabled || notFound}
            placeholder="/about"
            onChange={(event) => setPath(event.target.value)}
          />
        </label>
        <p className="hint">
          Use / for the home page.
          {page?.collection ? ' Keep the collection parameter in the path.' : ''} Changing a path
          updates links that point at this page automatically; manually entered URL links keep their
          original path.
        </p>
        {path.trim() === '/404' && (
          <p className="note">Served for unknown addresses. Not listed in the sitemap.</p>
        )}
        <label>
          Language
          <input
            value={lang}
            disabled={disabled}
            placeholder={doc.site.locale}
            onChange={(event) => setLang(event.target.value)}
          />
        </label>
        <p className="hint">Leave empty to use the site language.</p>
        <label>
          SEO title
          <input
            value={title}
            disabled={disabled}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          SEO description
          <textarea
            aria-label="SEO description"
            rows={3}
            value={description}
            disabled={disabled}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label>
          Canonical URL
          <input
            value={canonical}
            disabled={disabled}
            placeholder={doc.site.url ? doc.site.url + path.trim() : 'https://example.com/about'}
            onChange={(event) => setCanonical(event.target.value)}
          />
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={noindex}
            disabled={disabled}
            onChange={(event) => setNoindex(event.target.checked)}
          />
          Hide from search engines
        </label>
        <ImageChoice
          label="Social image"
          siteId={siteId}
          doc={doc}
          value={ogImage}
          disabled={disabled}
          choose={setOgImage}
        />
        <CodeField
          label="Head code"
          info={codeInfo('head')}
          value={headCode}
          disabled={disabled}
          change={setHeadCode}
        />
        <CodeField
          label="Body code"
          info={codeInfo('body')}
          value={bodyCode}
          disabled={disabled}
          change={setBodyCode}
        />
        <ErrorNote message={error} />
        <button type="submit" disabled={disabled}>
          {page ? 'Save page' : 'Create page'}
        </button>
      </form>
      {page && (
        <div className="page-management-actions">
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              try {
                const result = duplicatePage(doc, page.id)
                void run(result.operations, result.id)
              } catch (err) {
                setError((err as Error).message)
              }
            }}
          >
            Duplicate page
          </button>
          <button
            type="button"
            disabled={disabled || Object.keys(doc.pages).length <= 1 || page.path === '/'}
            onClick={() => setConfirmDelete(true)}
          >
            Delete page
          </button>
          {(page.path === '/' || Object.keys(doc.pages).length <= 1) && (
            <p className="hint">
              The home page and the last remaining page are protected from deletion.
            </p>
          )}
          {confirmDelete && (
            <div role="alert">
              <p>
                Delete “{page.name}” and all its content? Existing links to this page may stop
                working. You can undo this during this session.
              </p>
              <button
                type="button"
                disabled={disabled}
                onClick={() => void run([{ type: 'page.delete', id: page.id }])}
              >
                Confirm delete page
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)}>
                Keep page
              </button>
            </div>
          )}
        </div>
      )}
    </Dialog>
  )
}
