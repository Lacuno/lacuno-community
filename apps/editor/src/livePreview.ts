export type LivePreview = {
  node?: {
    id: string
    text?: string
    attrs?: Record<string, string>
    selector?: string
    media?: string
    styles: Record<string, string | null>
  }
  colors?: Record<string, string>
}
