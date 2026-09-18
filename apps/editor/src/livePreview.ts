export type LivePreview = {
  node?: { id: string; text?: string; selector?: string; styles: Record<string, string | null> }
  colors?: Record<string, string>
}
