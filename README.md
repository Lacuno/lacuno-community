# Freeflow

**An open source, self-hostable web design tool with an agent built in.**

Design visually like Webflow. Publish blazing-fast static sites built by Astro. Let AI agents work
alongside you on the same document, on the canvas and from the terminal. Run it all on your own server
with one command.

> Status: pre-alpha. We are writing down what we want to build before we build it.
> Start with [docs/VISION.md](docs/VISION.md).

## Documents

| Doc | What it covers |
| --- | --- |
| [docs/VISION.md](docs/VISION.md) | Why Freeflow exists, who it is for, the principles we will not compromise on |
| [docs/FEATURES.md](docs/FEATURES.md) | The full feature map, what ships when, and what we deliberately defer |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Data model, compiler, editor, server, storage, publishing, tech stack |
| [docs/AGENTS.md](docs/AGENTS.md) | The agent layer: in-app agent, MCP, skills, proposals, safety |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phases and milestones |
| [docs/LANDSCAPE.md](docs/LANDSCAPE.md) | What Webstudio, Webflow, Framer, Onlook, Plasmic and Puck do, and where we differ |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Decision log. Every big call, the alternatives, and why |

## The pitch in five lines

1. **Self-hosted.** One Docker image, SQLite, local or S3 assets, Caddy for TLS. `docker run` and you are live.
2. **Open source.** The builder, the compiler, the CMS, the agent, the publishing pipeline. No open-core trapdoor.
3. **Great UX.** A real CSS editor with classes, breakpoints, states and tokens. It teaches the box model instead of hiding it.
4. **Agentic.** An agent on the canvas that proposes changes you can see, plus an MCP server so Claude Code or any agent edits the same document.
5. **Blazing fast.** The document compiles to an Astro project. Static HTML, zero JavaScript by default, islands when you need them.

## License

AGPL-3.0-or-later for the whole project. See [docs/DECISIONS.md](docs/DECISIONS.md) for the reasoning.
