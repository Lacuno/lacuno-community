/** How an app takes the site's MCP URL: a link it opens, a terminal command or a pasted URL. */
export type Registration = 'link' | 'command' | 'paste'

export type ConnectApp = {
  id: string
  name: string
  /** One line on what to do with the action. */
  how: string
  registration: Registration
  /** The link, command or URL for the site's MCP URL. */
  build: (url: string) => string
  needsPublicAddress: boolean
  /** A config snippet that reaches the site from the designer's machine, for local instances. */
  bridge?: (url: string) => string
  /** A short line for when the action does not work. */
  fallback: string
}

export const claudeCodeCommand = (url: string) => `claude mcp add --transport http freeflow ${url}`
export const cursorLink = (url: string) =>
  `cursor://anysphere.cursor-deeplink/mcp/install?name=freeflow&config=${btoa(JSON.stringify({ url }))}`
export const vscodeLink = (url: string) =>
  `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: 'freeflow', type: 'http', url }))}`
export const claudeDesktopBridge = (url: string) =>
  JSON.stringify(
    { mcpServers: { freeflow: { command: 'npx', args: ['-y', 'mcp-remote', url] } } },
    null,
    2,
  )
export const codexCommand = (url: string) => `codex mcp add freeflow --url ${url}`
export const geminiCommand = (url: string) => `gemini mcp add --transport http freeflow ${url}`
const pasted = (url: string) => url

export const connectApps: ConnectApp[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    how: 'Run this command in your terminal.',
    registration: 'command',
    build: claudeCodeCommand,
    needsPublicAddress: false,
    fallback: 'Connectors you add on claude.ai show up in Claude Code too.',
  },
  {
    id: 'claude-ai',
    name: 'claude.ai',
    how: 'In Customize → Connectors (claude.ai/customize/connectors), choose Add custom connector and paste the URL.',
    registration: 'paste',
    build: pasted,
    needsPublicAddress: true,
    fallback: 'On Team and Enterprise, an owner adds it in Organization settings → Connectors.',
  },
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    how: 'In Settings → Connectors, choose Add custom connector and paste the URL.',
    registration: 'paste',
    build: pasted,
    needsPublicAddress: true,
    bridge: claudeDesktopBridge,
    fallback: 'Or use a local bridge: add this to claude_desktop_config.json and restart the app.',
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    how: 'Turn on Settings → Security and login → Developer mode, then at chatgpt.com/plugins choose + and paste the URL.',
    registration: 'paste',
    build: pasted,
    needsPublicAddress: true,
    fallback: 'Web only, on Plus, Pro, Business, Enterprise or Edu.',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    how: 'Open the link and confirm the install in Cursor.',
    registration: 'link',
    build: cursorLink,
    needsPublicAddress: false,
    fallback: "Nothing opens? Add the MCP URL in Cursor's MCP settings.",
  },
  {
    id: 'vscode',
    name: 'VS Code',
    how: 'Open the link and confirm the install in VS Code.',
    registration: 'link',
    build: vscodeLink,
    needsPublicAddress: false,
    fallback: 'Nothing opens? Add the MCP URL under "servers" in .vscode/mcp.json.',
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    how: 'Run this command in your terminal.',
    registration: 'command',
    build: codexCommand,
    needsPublicAddress: false,
    fallback: 'Then run "codex mcp login freeflow" to sign in.',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    how: 'Run this command in your terminal.',
    registration: 'command',
    build: geminiCommand,
    needsPublicAddress: false,
    fallback: 'Or add the MCP URL as httpUrl under mcpServers in settings.json.',
  },
]
