import { backupWorkspace, restoreWorkspace, verifyBackup } from './backup.js'

const [command, source, destination, ...extra] = process.argv.slice(2)
if (
  !source ||
  extra.length ||
  (command === 'verify' ? !!destination : !destination) ||
  !['backup', 'verify', 'restore'].includes(command ?? '')
) {
  console.error(
    'Usage: backup-cli.js backup|restore <source> <empty-destination> OR verify <backup>',
  )
  process.exitCode = 1
} else {
  try {
    if (command === 'backup') await backupWorkspace(source, destination!)
    else if (command === 'restore') await restoreWorkspace(source, destination!)
    else await verifyBackup(source)
    console.log(`${command} completed`)
  } catch {
    console.error(
      `${command} failed. Live data was not modified; incomplete output must not be used.`,
    )
    process.exitCode = 1
  }
}
