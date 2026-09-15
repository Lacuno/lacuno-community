#!/usr/bin/env node
import { main } from './cli.js'

process.exitCode = await main(process.argv.slice(2), {
  log: (s) => console.log(s),
  error: (s) => console.error(s),
})
