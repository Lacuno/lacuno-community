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
    // 'options' is an invalid caller-supplied BuildOptions value, rejected before any write.
    public kind: 'document' | 'render' | 'engine' | 'options',
    message: string,
    public detail?: string,
  ) {
    super(message)
    this.name = 'BuildError'
  }
}
