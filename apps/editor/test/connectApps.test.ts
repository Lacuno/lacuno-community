import { expect, it } from 'vitest'
import {
  claudeCodeCommand,
  claudeDesktopBridge,
  codexCommand,
  connectApps,
  cursorLink,
  geminiCommand,
  vscodeLink,
} from '../src/connectApps.js'

const url = 'http://localhost:3000/mcp/site-1'

it('builds each app registration for the site MCP URL', () => {
  expect(claudeCodeCommand(url)).toBe(
    'claude mcp add --transport http freeflow http://localhost:3000/mcp/site-1',
  )
  expect(cursorLink(url)).toBe(
    'cursor://anysphere.cursor-deeplink/mcp/install?name=freeflow&config=eyJ1cmwiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAvbWNwL3NpdGUtMSJ9',
  )
  expect(vscodeLink(url)).toBe(
    'vscode:mcp/install?%7B%22name%22%3A%22freeflow%22%2C%22type%22%3A%22http%22%2C%22url%22%3A%22http%3A%2F%2Flocalhost%3A3000%2Fmcp%2Fsite-1%22%7D',
  )
  expect(JSON.parse(claudeDesktopBridge(url))).toEqual({
    mcpServers: { freeflow: { command: 'npx', args: ['-y', 'mcp-remote', url, '--allow-http'] } },
  })
  expect(codexCommand(url)).toBe('codex mcp add freeflow --url http://localhost:3000/mcp/site-1')
  expect(geminiCommand(url)).toBe(
    'gemini mcp add --transport http freeflow http://localhost:3000/mcp/site-1',
  )
  expect(
    connectApps.filter((app) => app.registration === 'paste').map((app) => app.build(url)),
  ).toEqual([url, url, url])
  expect(connectApps.map((app) => [app.name, app.needsPublicAddress])).toEqual([
    ['Claude Code', false],
    ['claude.ai', true],
    ['Claude Desktop', true],
    ['ChatGPT', true],
    ['Cursor', false],
    ['VS Code', false],
    ['Codex CLI', false],
    ['Gemini CLI', false],
  ])
})
