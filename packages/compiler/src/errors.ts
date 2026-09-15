/** A document reference or rule the renderer cannot satisfy. Names the node and page. */
export class RenderError extends Error {
  constructor(
    message: string,
    public node?: string,
    public page?: string,
  ) {
    super(message)
    this.name = 'RenderError'
  }
}

/** Anything that stops a build, classified for the CLI. */
export class BuildError extends Error {
  constructor(
    public kind: 'document' | 'render' | 'engine',
    message: string,
    public detail?: string,
  ) {
    super(message)
    this.name = 'BuildError'
  }
}
