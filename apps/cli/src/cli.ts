import { BUILD_USAGE, type Io, runBuild } from './build.js'

const USAGE = `freeflow, the Freeflow command line

Commands:
  build   Build a site folder to static output

${BUILD_USAGE}`

export async function main(argv: string[], io: Io): Promise<number> {
  const [command, ...rest] = argv
  if (!command) {
    io.log(USAGE)
    return 1
  }
  if (command === '--help' || command === '-h' || command === 'help') {
    io.log(USAGE)
    return 0
  }
  if (command === 'build') return runBuild(rest, io)
  io.error(`unknown command ${command}\n${USAGE}`)
  return 1
}
