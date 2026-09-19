import type { RichText, TextNode } from '@freeflow/schema'

type Run = {
  type?: string
  text?: string
  content?: Run[]
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}
export function textLink(node: TextNode): Record<string, unknown> | undefined {
  const links: Record<string, unknown>[] = []
  const visit = (run: Run) => {
    const link = run.marks?.find((mark) => mark.type === 'link')
    if (link?.attrs) links.push(link.attrs)
    run.content?.forEach(visit)
  }
  if (node.text.type === 'doc')
    node.text.content?.forEach((run) => {
      visit(run as Run)
    })
  return links.length && links.every((link) => JSON.stringify(link) === JSON.stringify(links[0]))
    ? links[0]
    : undefined
}
export function wholeText(
  node: TextNode,
  properties: string[],
  link?: { pageId: string | null; href: string | null } | null,
): RichText {
  const document: RichText =
    node.text.type === 'doc'
      ? structuredClone(node.text)
      : {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content:
                node.text.type === 'static' && String(node.text.value)
                  ? [{ type: 'text', text: String(node.text.value) }]
                  : [],
            },
          ],
        }
  const attrs: Record<string, string> = {
    'font-family': 'fontFamily',
    'font-size': 'fontSize',
    color: 'color',
    'font-weight': 'fontWeight',
    'font-style': 'fontStyle',
  }
  const visit = (run: Run) => {
    if (run.type === 'text') {
      run.marks = (run.marks ?? []).filter((mark) => {
        if (properties.includes('font-weight') && mark.type === 'bold') return false
        if (properties.includes('font-style') && mark.type === 'italic') return false
        if (link !== undefined && mark.type === 'link') return false
        if (mark.type === 'textStyle') {
          for (const property of properties)
            if (mark.attrs && attrs[property]) delete mark.attrs[attrs[property]!]
          return Object.values(mark.attrs ?? {}).some((value) => value != null)
        }
        return true
      })
      if (link) run.marks.push({ type: 'link', attrs: link })
      if (!run.marks.length) delete run.marks
    }
    run.content?.forEach(visit)
  }
  document.content?.forEach((run) => {
    visit(run as Run)
  })
  return document
}
