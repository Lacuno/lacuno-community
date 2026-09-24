import { type RichText, type TextNode, textStyleProperties } from '@miralo/schema'

export const textStyleAttributes: Record<string, string> = Object.fromEntries(
  Object.entries(textStyleProperties).map(([attribute, property]) => [property, attribute]),
)
export const textProperties = [...Object.values(textStyleProperties), 'text-align', 'line-height']

export function textDocument(text: TextNode['text']): RichText {
  if (text.type === 'doc') return structuredClone(text)
  if (text.type !== 'static') throw new Error('Bound text cannot be edited directly.')
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: String(text.value) ? [{ type: 'text', text: String(text.value) }] : [],
      },
    ],
  }
}

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
  const document = textDocument(node.text)
  const visit = (run: Run) => {
    if (run.type === 'text') {
      run.marks = (run.marks ?? []).filter((mark) => {
        if (properties.includes('font-weight') && mark.type === 'bold') return false
        if (properties.includes('font-style') && mark.type === 'italic') return false
        if (link !== undefined && mark.type === 'link') return false
        if (mark.type === 'textStyle') {
          // A range keeps its own colour through a whole-text colour change.
          for (const property of properties)
            if (mark.attrs && property !== 'color' && textStyleAttributes[property])
              delete mark.attrs[textStyleAttributes[property]!]
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
