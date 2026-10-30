import assert from 'node:assert/strict'
import http from 'node:http'
import { triggerBuild } from '../lib/jenkins.js'

// A fake Jenkins whose build numbers behave like the real one: a number is
// assigned when the build STARTS, so right after the trigger the job's lastBuild
// is still the previous, already finished build. The old code polled
// `nextBuildNumber - 1` and reported that previous build's ABORTED result as
// this trigger's outcome.
function fakeJenkins(options = {}) {
  const nextNumber = options.nextNumber ?? 7
  const oldTs = Date.now() - 10 * 60 * 1000
  const state = { lastCalls: 0, build7Calls: 0, aborted7: false, port: 0 }

  const jobBuild = (number, result, building, ts) => ({
    number,
    result: building ? null : result,
    building,
    timestamp: ts,
    url: `http://127.0.0.1:${state.port}/job/demo/${number}/`,
  })

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const json = (body, code = 200) => {
      res.writeHead(code, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    const text = (body) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end(body)
    }

    if (url.pathname === '/crumbIssuer/api/json') return json({}, 404)
    if (url.pathname === '/job/demo/buildWithParameters' && req.method === 'POST') {
      res.writeHead(201, { location: '/queue/item/1/' })
      return res.end('')
    }
    if (url.pathname === '/job/demo/api/json') {
      if (url.search.includes('nextBuildNumber')) return json({ nextBuildNumber: nextNumber })
      state.lastCalls += 1
      const previous = jobBuild(nextNumber - 1, options.oldResult ?? 'ABORTED', false, oldTs)
      if (!options.newBuild) return json({ lastBuild: previous })
      if (state.lastCalls <= (options.appearAfter ?? 1)) return json({ lastBuild: previous })
      if (options.followUp && state.aborted7) {
        return json({ lastBuild: jobBuild(nextNumber + 1, 'SUCCESS', false, Date.now()) })
      }
      return json({ lastBuild: jobBuild(nextNumber, options.newResult ?? 'SUCCESS', true, Date.now()) })
    }
    const buildMatch = /^\/job\/demo\/(\d+)\/api\/json$/.exec(url.pathname)
    if (buildMatch) {
      const number = Number(buildMatch[1])
      if (number === nextNumber - 1) return json(jobBuild(number, options.oldResult ?? 'ABORTED', false, oldTs))
      if (number === nextNumber && options.newBuild) {
        state.build7Calls += 1
        const building = state.build7Calls <= (options.buildingPolls ?? 1)
        if (!building) state.aborted7 = (options.newResult ?? 'SUCCESS') !== 'SUCCESS'
        return json(jobBuild(number, options.newResult ?? 'SUCCESS', building, Date.now()))
      }
      if (options.followUp && number === nextNumber + 1) return json(jobBuild(number, 'SUCCESS', false, Date.now()))
      return json({}, 404)
    }
    const consoleMatch = /^\/job\/demo\/(\d+)\/consoleText$/.exec(url.pathname)
    if (consoleMatch) return text(`pushed image test-aaaaaaaaaaaa-${Number(consoleMatch[1])}\n`)
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end('{}')
  })

  return {
    state,
    listen: () => new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        state.port = server.address().port
        process.env.JENKINS_URL = `http://127.0.0.1:${state.port}`
        process.env.JENKINS_USER = 'tester'
        process.env.JENKINS_API_TOKEN = 'token'
        resolve()
      })
    }),
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

const project = { name: 'demo', jenkins: { test: { job: 'demo', branchParam: 'BRANCH' } } }
const run = (waitSeconds) => triggerBuild({ project, env: 'test', branch: 'develop', waitSeconds })

// 1. The bug: the previous build is ABORTED, the triggered build succeeds.
{
  const fake = fakeJenkins({ newBuild: true, newResult: 'SUCCESS' })
  await fake.listen()
  try {
    const out = await run(8)
    assert.equal(out.status, 'success', 'must follow the triggered build, not the previous ABORTED one')
    assert.equal(out.buildNumber, 7, 'must report the triggered build number')
    assert.equal(out.tag, 'test-aaaaaaaaaaaa-7')
  } finally {
    await fake.close()
  }
}

// 2. Nothing started yet: that is "queued", not a failure.
{
  const fake = fakeJenkins({ newBuild: false })
  await fake.listen()
  try {
    const out = await run(3)
    assert.equal(out.status, 'queued', 'an unstarted trigger must stay queued')
  } finally {
    await fake.close()
  }
}

// 3. The triggered build was cancelled and a replacement build ran: adopt it.
{
  const fake = fakeJenkins({ newBuild: true, newResult: 'ABORTED', followUp: true })
  await fake.listen()
  try {
    const out = await run(8)
    assert.equal(out.status, 'success', 'a replacement build must be adopted')
    assert.equal(out.buildNumber, 8)
    assert.equal(out.tag, 'test-aaaaaaaaaaaa-8')
  } finally {
    await fake.close()
  }
}

console.log('jenkins-trigger: ok')