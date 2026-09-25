import { execFile } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { get } from 'node:http'
import { setTimeout } from 'node:timers/promises'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const docker = async (...args) => (await exec('docker', args)).stdout.trim()
const image = process.argv[2] ?? 'miralo-community:local'
const name = `miralo-smoke-${randomUUID()}`
const volume = `${name}-data`
const restoredVolume = `${name}-restored`
const secret = randomBytes(32).toString('hex')
const origin = 'http://localhost:3000'
let containerCreated = false
let volumeCreated = false
let restoredVolumeCreated = false

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function waitFor(probe, description) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await probe().catch(() => false)) return
    await setTimeout(500)
  }
  throw new Error(`Timed out waiting for ${description}`)
}

try {
  await docker('volume', 'create', volume)
  volumeCreated = true
  const launch = async (dataVolume) =>
    docker(
      'run',
      '--detach',
      '--init',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '--name',
      name,
      '--publish',
      '127.0.0.1::3000',
      '--publish',
      '127.0.0.1::3001',
      '--mount',
      `type=volume,source=${dataVolume},target=/data`,
      '--env',
      `BETTER_AUTH_SECRET=${secret}`,
      '--env',
      `BETTER_AUTH_URL=${origin}`,
      '--env',
      'MIRALO_PUBLISH_BASE_URL=http://localhost:3001',
      '--env',
      'MIRALO_ALLOW_SIGNUP=false',
      image,
    )
  await launch(volume)
  containerCreated = true
  let api = `http://${await docker('port', name, '3000/tcp')}`
  let publicAddress = await docker('port', name, '3001/tcp')
  const healthy = () =>
    waitFor(
      async () => (await fetch(`${api}/health`, { signal: AbortSignal.timeout(3000) })).ok,
      'API health',
    )
  await healthy()
  assert((await docker('exec', name, 'id', '-u')) !== '0', 'Server must run as non-root')
  await docker(
    'exec',
    name,
    'node',
    '-e',
    "if(require('node:fs').existsSync('/app/.env')) process.exit(1)",
  )
  const post = (route, body, cookie = '') =>
    fetch(`${api}${route}`, {
      method: 'POST',
      headers: { origin, cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  const setupToken = await docker('exec', name, 'node', 'apps/server/dist/setup-token.js')
  const registered = await post('/api/setup', {
    token: setupToken,
    name: 'Docker smoke',
    email: 'docker@example.test',
    password: randomBytes(24).toString('hex'),
  })
  assert(registered.ok, `Registration failed: ${await registered.text()}`)
  const config = await (await fetch(`${api}/api/config`)).json()
  assert(!config.allowSignup && !config.setupRequired, 'Registration must close after owner setup')
  const cookie = registered.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ')
  const created = await post('/api/sites', { name: 'Container smoke site' }, cookie)
  assert(created.status === 201, `Site creation failed: ${created.status}`)
  const { id } = await created.json()
  const edited = await post(
    `/api/sites/${id}/document/apply`,
    {
      expectedRevision: 0,
      operations: [{ type: 'site.update', name: 'Persisted in Docker' }],
    },
    cookie,
  )
  assert(edited.ok, 'Document edit failed')
  const published = await post(
    `/api/sites/${id}/releases`,
    { expectedRevision: 1, expectedId: null },
    cookie,
  )
  assert(published.status === 202, 'Publish was not queued')
  const { id: releaseId } = await published.json()
  const history = async () =>
    (await fetch(`${api}/api/sites/${id}/releases`, { headers: { cookie } })).json()
  await waitFor(async () => (await history()).releases[0]?.status === 'ready', 'compiled release')
  assert((await history()).releases[0].version === 1, 'First publish must be v1')
  await docker('restart', name)
  // Docker may assign new ephemeral host ports when restarting the container.
  api = `http://${await docker('port', name, '3000/tcp')}`
  publicAddress = await docker('port', name, '3001/tcp')
  await healthy()
  // Exercise the documented offline archive/restore procedure against a fresh volume.
  await docker('stop', name)
  const archive = await exec(
    'docker',
    [
      'run',
      '--rm',
      '--mount',
      `type=volume,source=${volume},target=/data,readonly`,
      '--entrypoint',
      'tar',
      image,
      '-czf',
      '-',
      '-C',
      '/data',
      '.',
    ],
    { encoding: 'buffer', maxBuffer: 20 * 1024 * 1024 },
  )
  await docker('volume', 'create', restoredVolume)
  restoredVolumeCreated = true
  await new Promise((resolve, reject) => {
    const restore = execFile(
      'docker',
      [
        'run',
        '--rm',
        '-i',
        '--mount',
        `type=volume,source=${restoredVolume},target=/data`,
        '--entrypoint',
        'tar',
        image,
        '-xzf',
        '-',
        '--no-same-owner',
        '-C',
        '/data',
      ],
      (error) => (error ? reject(error) : resolve()),
    )
    restore.stdin.on('error', reject)
    restore.stdin.end(archive.stdout)
  })
  await docker('rm', name)
  containerCreated = false
  await launch(restoredVolume)
  containerCreated = true
  api = `http://${await docker('port', name, '3000/tcp')}`
  publicAddress = await docker('port', name, '3001/tcp')
  await healthy()
  const snapshot = await (
    await fetch(`${api}/api/sites/${id}/document`, { headers: { cookie } })
  ).json()
  assert(snapshot.document.site.name === 'Persisted in Docker', 'Draft did not survive restart')
  assert((await history()).publishedId === releaseId, 'Live pointer did not survive restart')
  await new Promise((resolve, reject) => {
    get(`http://${publicAddress}/`, { headers: { host: `${id}.localhost:3001` } }, (response) => {
      let html = ''
      response.on('data', (chunk) => {
        html += chunk
      })
      response.on('error', reject)
      response.on('end', () => {
        try {
          assert(response.statusCode === 200, 'Published page is unavailable')
          assert(response.headers['x-miralo-release'] === releaseId, 'Wrong live release')
          assert(html.includes('Your website. Your rules.'), 'Published page content is missing')
          resolve()
        } catch (error) {
          reject(error)
        }
      })
    }).on('error', reject)
  })
  console.log(
    'Docker smoke passed: non-root, sign-in, editing, publishing, restart, backup/restore and live output.',
  )
} catch (error) {
  // `docker logs` replays the server's stderr, where its errors go, on its own stderr.
  if (containerCreated)
    console.error(
      await exec('docker', ['logs', name]).then(
        (logs) => logs.stdout + logs.stderr,
        () => 'Cannot read container logs',
      ),
    )
  throw error
} finally {
  // These unique resources belong solely to this test; never touch an operator's instance.
  if (containerCreated) await docker('rm', '--force', name)
  if (volumeCreated) await docker('volume', 'rm', volume)
  if (restoredVolumeCreated) await docker('volume', 'rm', restoredVolume)
}
