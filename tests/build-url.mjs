// Jenkins answers with the absolute URL from its own configuration, which is
// routinely an internal host:port the machine running the plugin cannot reach.
// Polling that address verbatim timed out, the timeout was reported as
// "running", and a finished build stayed 构建中 for hours.
import assert from 'node:assert/strict'
import test from 'node:test'

const { alignBuildUrl, pollBuildUrl } = await import('../lib/jenkins.js')

const BASE = 'https://jenkins.biomap-int.com'

test('a Jenkins-internal build URL is polled on the configured base', () => {
  const aligned = alignBuildUrl('http://172.16.32.9:8080/job/tongxi-test/84/', BASE)
  assert.equal(aligned, 'https://jenkins.biomap-int.com/job/tongxi-test/84/')
})

test('the build number and job path survive the rewrite', () => {
  const aligned = alignBuildUrl('http://10.0.0.7:8080/job/team/job/app/91/', BASE)
  assert.equal(new URL(aligned).pathname, '/job/team/job/app/91/')
})

test('a URL already on the configured base is left alone', () => {
  const url = 'https://jenkins.biomap-int.com/job/tongxi-test/84/'
  assert.equal(alignBuildUrl(url, BASE), url)
})

test('a relative path resolves against the base', () => {
  assert.equal(alignBuildUrl('/job/tongxi-test/85/', BASE), 'https://jenkins.biomap-int.com/job/tongxi-test/85/')
})

test('a base installed under a path prefix keeps its prefix', () => {
  const aligned = alignBuildUrl('http://10.0.0.9:8080/job/x/84/', 'https://ci.example.com/jenkins')
  assert.equal(aligned, 'https://ci.example.com/jenkins/job/x/84/')
})

test('an empty pointer stays empty instead of becoming the base', () => {
  assert.equal(alignBuildUrl('', BASE), '')
})

test('an unreachable endpoint is not reported as a build in progress', async () => {
  // Nothing listens on this port, so the connection is refused immediately: a
  // network failure must answer "unreachable", never "running".
  const result = await pollBuildUrl({
    buildUrl: 'http://127.0.0.1:9/job/tongxi-test/84/',
    headers: {},
    deadline: Date.now(),
    intervalMs: 10,
    expectedEnv: 'test',
    base: 'http://127.0.0.1:9',
  })
  assert.equal(result.status, 'unreachable')
  assert.ok(result.error, 'the reason must be kept for the operator')
})