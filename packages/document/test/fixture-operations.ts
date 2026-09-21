import { color, designToken, fn, kw, list, px, rem } from '@freeflow/schema'
import type { Operation } from '../src/operations/index.js'

const text = (s: string) => ({
  type: 'doc' as const,
  content: [{ type: 'paragraph', content: [{ type: 'text', text: s }] }],
})
const style = (
  cls: string,
  property: string,
  value: unknown,
  extra: Partial<{ breakpoint: string; state: string }> = {},
): Operation =>
  ({
    type: 'style.set',
    class: cls,
    breakpoint: extra.breakpoint ?? 'base',
    state: (extra.state ?? 'none') as 'none',
    property,
    value,
  }) as Operation
const token = (
  id: string,
  name: string,
  group: string,
  values: Record<string, unknown>,
): Operation => ({ type: 'designToken.create', id, name, group, values }) as Operation

/**
 * The exact operation batch that rebuilds the fixture document from an empty one, starting with
 * deleting the empty document's initial page. Shared by the document package's end-to-end test
 * and the MCP package's end-to-end test so the fixture is defined once.
 */
export function fixtureOperations(initialPageId: string): Operation[] {
  return [
    { type: 'page.delete', id: initialPageId },
    {
      type: 'site.update',
      fonts: [{ family: 'system-ui', source: 'system', fallback: 'sans-serif' }],
    },
    {
      type: 'mode.create',
      id: 'dark',
      label: 'Dark',
      selector: '[data-theme="dark"]',
      media: '(prefers-color-scheme: dark)',
    },
    token('t-font-body', 'font.body', 'typography', {
      light: { type: 'raw', value: 'Inter, system-ui, sans-serif' },
    }),
    token('t-fg', 'color.fg', 'color', { light: color('#111'), dark: color('#eee') }),
    token('t-bg', 'color.bg', 'color', { light: color('#fff'), dark: color('#111') }),
    token('t-brand', 'color.brand', 'color', { light: color('#3b5bdb') }),
    token('t-brand-hover', 'color.brand.hover', 'color', {
      light: color('#2f4ac0'),
      dark: color('#5c7cfa'),
    }),
    token('t-surface-muted', 'color.surface.muted', 'color', {
      light: color('#f1f3f5'),
      dark: color('#222'),
    }),
    token('t-border', 'color.border', 'color', { light: color('#dee2e6'), dark: color('#333') }),
    token('t-space-sm', 'space.sm', 'spacing', { light: rem(0.5) }),
    token('t-space-md', 'space.md', 'spacing', { light: rem(1) }),
    token('t-space-lg', 'space.lg', 'spacing', { light: rem(2) }),
    token('t-radius', 'radius.md', 'radius', { light: px(8) }),
    { type: 'class.create', id: 'c-page', name: 'page' },
    { type: 'class.create', id: 'c-container', name: 'container' },
    { type: 'class.create', id: 'c-hero', name: 'hero' },
    { type: 'class.create', id: 'c-heading', name: 'heading' },
    { type: 'class.create', id: 'c-button', name: 'button' },
    { type: 'class.create', id: 'c-button-primary', name: 'primary', combo: ['c-button'] },
    { type: 'class.create', id: 'c-card', name: 'card' },
    { type: 'class.create', id: 'c-post-grid', name: 'post-grid' },
    { type: 'class.create', id: 'l-hero-title', local: true },
    style('c-page', 'font-family', designToken('t-font-body')),
    style('c-page', 'color', designToken('t-fg')),
    style('c-page', 'background-color', designToken('t-bg')),
    style('c-container', 'max-width', px(1200)),
    style('c-container', 'margin', list([px(0), kw('auto')])),
    style('c-container', 'padding', list([px(0), designToken('t-space-md')])),
    style('c-hero', 'display', kw('grid')),
    style(
      'c-hero',
      'grid-template-columns',
      fn('repeat', [
        { type: 'unit', value: 2, unit: 'number' },
        { type: 'unit', value: 1, unit: 'fr' },
      ]),
    ),
    style('c-hero', 'gap', designToken('t-space-lg')),
    style(
      'c-hero',
      'padding-block',
      fn('clamp', [rem(3), { type: 'unit', value: 8, unit: 'vw' }, rem(8)]),
    ),
    style(
      'c-hero',
      'grid-template-columns',
      { type: 'unit', value: 1, unit: 'fr' },
      { breakpoint: 'tablet' },
    ),
    style(
      'c-heading',
      'font-size',
      fn('clamp', [rem(2), { type: 'unit', value: 5, unit: 'vw' }, rem(4)]),
    ),
    style('c-heading', 'line-height', { type: 'unit', value: 1.1, unit: 'number' }),
    style('c-heading', 'margin', px(0)),
    style('c-heading', 'text-align', kw('center'), { breakpoint: 'mobile-p' }),
    style('c-button', 'display', kw('inline-flex')),
    style('c-button', 'padding', list([designToken('t-space-sm'), designToken('t-space-md')])),
    style('c-button', 'border-radius', designToken('t-radius')),
    style('c-button', 'text-decoration', kw('none')),
    style(
      'c-button',
      'transition',
      list([kw('background-color'), { type: 'unit', value: 150, unit: 'ms' }]),
    ),
    style('c-button', 'background-color', designToken('t-surface-muted'), { state: 'hover' }),
    style('c-button', 'outline', list([px(2), kw('solid'), designToken('t-brand')]), {
      state: 'focus-visible',
    }),
    style('c-button-primary', 'background-color', designToken('t-brand')),
    style('c-button-primary', 'color', color('#fff')),
    style('c-button-primary', 'background-color', designToken('t-brand-hover'), {
      state: 'hover',
    }),
    style('l-hero-title', 'letter-spacing', { type: 'unit', value: -0.02, unit: 'em' }),
    style('c-card', 'border', list([px(1), kw('solid'), designToken('t-border')])),
    style('c-card', 'border-radius', designToken('t-radius')),
    style('c-card', 'padding', designToken('t-space-md')),
    style('c-card', 'content', { type: 'raw', value: '""' }, { state: 'before' }),
    style('c-post-grid', 'display', kw('grid')),
    style(
      'c-post-grid',
      'grid-template-columns',
      fn('repeat', [
        kw('auto-fill'),
        fn('minmax', [px(280), { type: 'unit', value: 1, unit: 'fr' }]),
      ]),
    ),
    style('c-post-grid', 'gap', designToken('t-space-md')),
    {
      type: 'asset.create',
      id: 'a-hero',
      name: 'hero.png',
      kind: 'image',
      hash: '0123456789abcdef'.repeat(4),
      mime: 'image/png',
      size: 0,
      width: 1200,
      height: 800,
      alt: 'Hero image',
    },
    {
      type: 'collection.create',
      id: 'col-posts',
      name: 'Posts',
      slug: 'posts',
      slugField: 'slug',
      fields: [
        { id: 'f-title', name: 'title', label: 'Title', type: 'text', required: true },
        { id: 'f-slug', name: 'slug', label: 'Slug', type: 'slug', required: true },
        { id: 'f-date', name: 'date', label: 'Date', type: 'date' },
        { id: 'f-body', name: 'body', label: 'Body', type: 'richtext' },
        {
          id: 'f-status',
          name: 'status',
          label: 'Status',
          type: 'option',
          options: [{ value: 'draft', label: 'Draft' }, { value: 'published' }],
        },
      ],
    },
    {
      type: 'entry.create',
      collection: 'col-posts',
      id: 'e-1',
      fields: {
        'f-title': 'Hello world',
        'f-slug': 'hello-world',
        'f-date': '2026-09-01',
        'f-status': 'published',
        'f-body': text('The first post.'),
      },
    },
    {
      type: 'entry.create',
      collection: 'col-posts',
      id: 'e-2',
      fields: {
        'f-title': 'Second post',
        'f-slug': 'second-post',
        'f-date': '2026-09-05',
        'f-status': 'published',
      },
    },
    {
      type: 'entry.create',
      collection: 'col-posts',
      id: 'e-3',
      fields: {
        'f-title': 'Third post',
        'f-slug': 'third-post',
        'f-date': '2026-09-10',
        'f-status': 'draft',
      },
    },
    {
      type: 'component.create',
      id: 'cmp-card',
      name: 'Card',
      props: [{ name: 'title', type: 'string', label: 'Title' }],
      root: {
        type: 'element',
        id: 'n-card',
        tag: 'article',
        classes: ['c-card'],
        children: [
          { type: 'text', id: 'n-card-title', tag: 'h3', text: { type: 'prop', prop: 'title' } },
          { type: 'slot', id: 'n-card-slot', name: 'body' },
        ],
      },
    },
    {
      type: 'page.create',
      id: 'p-home',
      name: 'Home',
      path: '/',
      seo: { title: 'Fixture Co', description: 'A fixture site.' },
      root: {
        type: 'element',
        id: 'n-home',
        tag: 'main',
        classes: ['c-page'],
        semantic: { role: 'page' },
        children: [
          {
            type: 'element',
            id: 'n-hero',
            tag: 'section',
            classes: ['c-container', 'c-hero'],
            semantic: { role: 'hero', constraints: ['above-fold'] },
            children: [
              {
                type: 'element',
                id: 'n-hero-inner',
                tag: 'div',
                children: [
                  {
                    type: 'text',
                    id: 'n-hero-title',
                    tag: 'h1',
                    classes: ['c-heading', 'l-hero-title'],
                    text: text('Design it. Publish it. Own it.'),
                  },
                  {
                    type: 'element',
                    id: 'n-hero-image',
                    tag: 'img',
                    attrs: {
                      src: { type: 'asset', asset: 'a-hero' },
                      alt: {
                        type: 'static',
                        value: 'A blue rectangle standing in for a hero image',
                      },
                      loading: { type: 'static', value: 'eager' },
                    },
                  },
                  {
                    type: 'text',
                    id: 'n-hero-cta',
                    tag: 'a',
                    classes: ['c-button', 'c-button-primary'],
                    attrs: { href: { type: 'static', value: '/blog' } },
                    text: text('Read the blog'),
                  },
                ],
              },
            ],
          },
          {
            type: 'collection-list',
            id: 'n-posts',
            tag: 'div',
            classes: ['c-container', 'c-post-grid'],
            collection: 'col-posts',
            query: { sort: [{ field: 'f-date', direction: 'desc' }], limit: 6 },
            children: [
              {
                type: 'component',
                id: 'n-post-card',
                component: 'cmp-card',
                props: { title: { type: 'field', field: 'f-title' } },
              },
            ],
          },
        ],
      },
    },
    {
      type: 'page.create',
      id: 'p-post',
      name: 'Post',
      path: '/blog/[slug]',
      collection: 'col-posts',
      root: {
        type: 'element',
        id: 'n-post',
        tag: 'main',
        classes: ['c-page', 'c-container'],
        children: [
          {
            type: 'text',
            id: 'n-post-title',
            tag: 'h1',
            classes: ['c-heading'],
            text: { type: 'field', field: 'f-title' },
          },
          {
            type: 'text',
            id: 'n-post-body',
            tag: 'div',
            text: { type: 'field', field: 'f-body' },
          },
        ],
      },
    },
    { type: 'redirect.add', from: '/old-blog', to: '/blog', status: 301 },
  ] as Operation[]
}
