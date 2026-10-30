// Reading a tag answers "what does this tag say". It is not a validation
// gate: only the caller knows which environment it asked for, so a tag that
// names no environment at all must not be rejected here.
import assert from 'node:assert/strict'
import test from 'node:test'

const { parseImageTag } = await import('../lib/jenkins.js')

test('a tag with no environment marker is read without an env', () => {
  const parsed = parseImageTag('build-42')
  assert.equal(parsed.tag, 'build-42')
  assert.equal(parsed.env, undefined)
})

test('the environment marker is read wherever it appears', () => {
  assert.equal(parseImageTag('web-test-7a3c647').env, 'test')
  assert.equal(parseImageTag('latest-prod').env, 'prod')
  assert.equal(parseImageTag('test-0123456789ab-42').env, 'test')
})

test('a commit prefix is read when the tag carries one', () => {
  assert.equal(parseImageTag('test-0123456789ab-42').sha, '0123456789ab')
  assert.equal(parseImageTag('web-prod-7a3c647').sha, '7a3c647')
  assert.equal(parseImageTag('latest-test').sha, undefined)
})

test('reading never throws, whatever the tag looks like', () => {
  for (const value of ['', 'x', 'deploy_v2', 'PROD-ABC-1', '低温-tag']) {
    assert.doesNotThrow(() => parseImageTag(value))
  }
})
