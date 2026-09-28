import type { Operation } from '@lacuno/document'
import type { Document, Page } from '@lacuno/schema'
import { useState } from 'react'
import { collectionPageCreation, freePath } from './binding.js'
import { CodeField } from './CodeField.js'
import { Dialog, ErrorNote } from './Dialog.js'
import { EditorIcon } from './EditorIcon.js'
import { Menu, type MenuPoint, menuPoint } from './Menu.js'
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
  const [menu, setMenu] = useState<{ page: Page; at: MenuPoint }>()
  const [deleting, setDeleting] = useState<Page>()
  const protectedPage = (page: Page) => page.path === '/' || Object.keys(doc.pages).length <= 1
  const openMenu = (page: Page, event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault()
    setMenu(menu?.page.id === page.id ? undefined : { page, at: menuPoint(event) })
  }
  return (
    <>
      <div className="panel-title">
        Pages<span>{Object.keys(doc.pages).length}</span>
      </div>
      <div className="pages-toolbar">
        <button type="button" disabled={disabled} onClick={() => setEditing('new')}>
          <EditorIcon name="plus" />
          New page
        </button>
        <button
          type="button"
          className="pages-site-settings"
          aria-label="Site settings"
          title="Site settings"
          disabled={disabled}
          onClick={() => setEditing('site')}
        >
          <EditorIcon name="settings" />
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
                onContextMenu={(event) => !disabled && openMenu(page, event)}
                title={`${page.name}\n${page.path}`}
                onClick={() => choose(page.id)}
              >
                <EditorIcon name={page.collection ? 'database' : 'page'} />
                <span className="page-name">
                  {page.name}
                  <small className="page-path">{page.path}</small>
                </span>
              </button>
              <button
                type="button"
                className="page-settings-trigger"
                aria-label={`Actions for ${page.name}`}
                aria-haspopup="menu"
                aria-expanded={menu?.page.id === page.id}
                title="Page actions"
                disabled={disabled}
                onClick={(event) => openMenu(page, event)}
              >
                •••
              </button>
            </div>
          ))}
      </div>
      {menu && (
        <Menu
          key={menu.page.id}
          at={menu.at}
          label={`${menu.page.name} actions`}
          close={() => setMenu(undefined)}
          items={[
            { label: 'Open', run: () => choose(menu.page.id) },
            { label: 'Page settings', run: () => setEditing(menu.page) },
            {
              label: 'Duplicate',
              run: async () => {
                const copy = duplicatePage(doc, menu.page.id)
                if (await save(copy.operations)) choose(copy.id)
              },
            },
            {
              label: 'Delete…',
              danger: true,
              disabled: protectedPage(menu.page),
              run: () => setDeleting(menu.page),
            },
          ]}
        />
      )}
      {deleting && (
        <Dialog
          title="Delete page"
          className="page-settings-dialog delete-page-dialog"
          disabled={disabled}
          close={() => setDeleting(undefined)}
        >
          <p>
            Delete “{deleting.name}” and all its content? Existing links to this page may stop
            working. You can undo this during this session.
          </p>
          <div className="row">
            <button
              type="button"
              className="danger"
              disabled={disabled}
              onClick={async () => {
                if (await save([{ type: 'page.delete', id: deleting.id }])) setDeleting(undefined)
              }}
            >
              Delete page
            </button>
            <button type="button" onClick={() => setDeleting(undefined)}>
              Keep page
            </button>
          </div>
        </Dialog>
      )}
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

export function PageSettings({
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
  // A new page may show each entry of a collection; an existing one keeps what it shows.
  const [collection, setCollection] = useState(page?.collection ?? '')
  const col = doc.collections[collection]
  const [seoFields, setSeoFields] = useState(page?.seo?.fields ?? {})
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
            : pagePathError(doc, path.trim(), page?.id, !!(page?.collection || col)) ||
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
            fields: col ? seoFields : {},
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
          else if (col) {
            const created = collectionPageCreation(doc, col, path.trim())
            for (const operation of created.operations)
              if (operation.type === 'page.create')
                Object.assign(operation, {
                  name: name.trim(),
                  path: path.trim(),
                  ...(lang.trim() ? { lang: lang.trim() } : {}),
                  seo: {
                    ...operation.seo,
                    ...seo,
                    fields: { ...operation.seo?.fields, ...seo.fields },
                  },
                  ...(headCode ? { headCode } : {}),
                  ...(bodyCode ? { bodyCode } : {}),
                })
            void run(created.operations, created.id)
          } else {
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
        {!page && Object.keys(doc.collections).length > 0 && (
          <label>
            Page for
            <select
              aria-label="Page for"
              value={collection}
              disabled={disabled || notFound}
              onChange={(event) => {
                const next = doc.collections[event.target.value]
                setCollection(event.target.value)
                setName(next ? `${next.name} page` : '')
                setPath(next ? freePath(doc, `/${next.slug}/[slug]`) : '')
              }}
            >
              <option value="">One page</option>
              {Object.values(doc.collections).map((item) => (
                <option key={item.id} value={item.id}>
                  Each entry of {item.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {!page && !collection && (
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
        {col &&
          (
            [
              ['title', 'Title from', 'text'],
              ['description', 'Description from', 'text'],
              ['ogImage', 'Social image from', 'image'],
            ] as const
          ).map(([key, label, kind]) => (
            <label key={key}>
              {label}
              <select
                aria-label={`SEO ${label.toLowerCase()}`}
                value={seoFields[key] ?? ''}
                disabled={disabled}
                onChange={(event) =>
                  setSeoFields({ ...seoFields, [key]: event.target.value || undefined })
                }
              >
                <option value="">
                  {kind === 'image' ? 'Social image below' : 'Written above'}
                </option>
                {col.fields
                  .filter((field) =>
                    kind === 'image'
                      ? field.type === 'image'
                      : ['text', 'richtext', 'slug'].includes(field.type),
                  )
                  .map((field) => (
                    <option key={field.id} value={field.id}>
                      {col.name} · {field.label}
                    </option>
                  ))}
              </select>
            </label>
          ))}
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
