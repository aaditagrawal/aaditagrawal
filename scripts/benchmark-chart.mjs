#!/usr/bin/env bun
// Reproducible CLI benchmark. Temporary API fixtures never contact GitHub.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { cpus, platform, release, tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = 'b40edbddbc620d7f78096231fe66309ce795590c'
const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')
const baseline = (path) => execFileSync('git', ['show', `${BASE}:${path}`], { cwd: root, encoding: 'utf8' })
const samples = Number(process.env.SAMPLES ?? 15)
if (!Number.isSafeInteger(samples) || samples < 5) throw new Error('SAMPLES must be an integer of at least 5')
const warmups = 2
const snapshot = JSON.parse(await read('data/language-stats.json'))
const extras = JSON.parse(await read('data/extra-languages.json'))
const localTotals = {}
for (const repo of Object.values(extras.repos)) {
  for (const [name, bytes] of Object.entries(repo.languages)) localTotals[name] = (localTotals[name] ?? 0) + bytes
}
const temp = await mkdtemp(join(tmpdir(), 'profile-chart-benchmark-'))
const summary = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (fraction) => sorted[Math.floor((sorted.length - 1) * fraction)]
  return { median_ms: at(0.5), p25_ms: at(0.25), p75_ms: at(0.75), min_ms: sorted[0], max_ms: sorted.at(-1), samples: values }
}

try {
  const fixtureDirs = {}
  const scenarios = [
    { name: 'small', repoCount: 1, languages: snapshot.languages.slice(0, 1) },
    { name: 'profile', repoCount: snapshot.repoCount, languages: snapshot.languages },
    { name: 'large', repoCount: 500, languages: snapshot.languages },
  ]
  for (const scenario of scenarios) {
    // Distribute the same totals across repositories. One repository is local.
    const apiCount = Math.max(scenario.repoCount - 1, 1)
    const local = scenario.repoCount > 1 ? localTotals : {}
    const repos = Array.from({ length: apiCount }, (_, i) => ({
      name: `repo${i}`, full_name: `owner/repo${i}`, fork: false, archived: false,
    }))
    const api = Object.fromEntries(repos.map((repo, i) => [`/repos/${repo.full_name}/languages`, Object.fromEntries(
      scenario.languages.map(({ name, bytes }) => {
        const remoteBytes = bytes - (local[name] ?? 0)
        assert.ok(remoteBytes >= 0)
        return [name, Math.floor(remoteBytes / apiCount) + (i < remoteBytes % apiCount ? 1 : 0)]
      }),
    )]))
    const allRepos = [...repos, { name: 'fork', fork: true }, { name: 'archived', archived: true }]
    for (let page = 1; ; page++) {
      const batch = allRepos.slice((page - 1) * 100, page * 100)
      api[`/user/repos?affiliation=owner&per_page=100&page=${page}`] = batch
      if (batch.length < 100) break
    }
    const languages = scenario.languages
    const totalBytes = languages.reduce((sum, item) => sum + item.bytes, 0)
    const stats = { generatedAt: snapshot.generatedAt, repoCount: scenario.repoCount, totalBytes,
      languages: languages.map(({ name, bytes }) => ({ name, bytes, share: bytes / totalBytes * 100 })) }
    const mockDate = `const NativeDate = Date; globalThis.Date = class extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [${JSON.stringify(snapshot.generatedAt)}])); }
      };\n`
    const mockApi = `const api = ${JSON.stringify(api)};
      globalThis.fetch = async (url) => {
        const path = String(url).replace('https://api.github.com', '');
        if (!Object.hasOwn(api, path)) throw new Error('Unexpected network request: ' + path);
        return { ok: true, json: async () => api[path] };
      };\n`
    for (const kind of ['baseline', 'candidate', 'offline']) {
      const dir = join(temp, `${scenario.name}-${kind}`)
      fixtureDirs[`${scenario.name}-${kind}`] = dir
      for (const subdir of ['scripts', 'data', 'assets']) await mkdir(join(dir, subdir), { recursive: true })
      const source = kind === 'baseline' ? baseline('scripts/generate-language-chart.mjs') : await read('scripts/generate-language-chart.mjs')
      const setup = mockDate + (kind === 'offline' ? 'globalThis.fetch = () => { throw new Error("Unexpected network request") };\n' : mockApi)
      await writeFile(join(dir, 'scripts/generate-language-chart.mjs'), setup +
        'const benchmarkStarted = performance.now(); const benchmarkCpuStarted = process.cpuUsage();\n' + source.replace(/^#![^\n]*\n/, '') +
        '\nconst benchmarkCpu = process.cpuUsage(benchmarkCpuStarted); console.log("BENCHMARK_RESULT=" + JSON.stringify({ work: performance.now() - benchmarkStarted, cpu: (benchmarkCpu.user + benchmarkCpu.system) / 1000 }));\n')
      if (kind !== 'baseline') await writeFile(join(dir, 'scripts/visual-style.mjs'), await read('scripts/visual-style.mjs'))
      await writeFile(join(dir, 'README.md'), kind === 'baseline' ? baseline('README.md') : await read('README.md'))
      await writeFile(join(dir, 'data/language-stats.json'), JSON.stringify(stats, null, 2) + '\n')
      await writeFile(join(dir, 'data/extra-languages.json'), JSON.stringify({ repos: Object.keys(local).length ? { local: { languages: local } } : {} }))
    }
  }
  const run = (dir, offline = false) => {
    const begin = performance.now()
    const result = spawnSync(process.execPath, [join(dir, 'scripts/generate-language-chart.mjs'), ...(offline ? ['--from-stats'] : [])], {
      encoding: 'utf8', env: { ...process.env, GITHUB_TOKEN: offline ? '' : 'benchmark-placeholder' },
    })
    const cli = performance.now() - begin
    assert.equal(result.status, 0, result.stderr)
    return { cli, ...JSON.parse(result.stdout.match(/BENCHMARK_RESULT=(.+)/)[1]) }
  }
  const startup = []
  for (let i = -warmups; i < samples; i++) {
    const begin = performance.now()
    const result = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    if (i >= 0) startup.push(performance.now() - begin)
  }
  const measurements = []
  for (const scenario of scenarios) {
    for (const kind of ['baseline', 'candidate', 'offline']) run(fixtureDirs[`${scenario.name}-${kind}`], kind === 'offline')
    // Statistics match the baseline; redesigned online/offline SVGs match each other.
    const saved = await readFile(join(fixtureDirs[`${scenario.name}-baseline`], 'data/language-stats.json'), 'utf8')
    for (const kind of ['candidate', 'offline']) assert.equal(await readFile(join(fixtureDirs[`${scenario.name}-${kind}`], 'data/language-stats.json'), 'utf8'), saved)
    for (const path of ['assets/languages-light.svg', 'assets/languages-dark.svg', 'assets/languages-light-compact.svg', 'assets/languages-dark-compact.svg']) {
      const expected = await readFile(join(fixtureDirs[`${scenario.name}-candidate`], path), 'utf8')
      assert.equal(await readFile(join(fixtureDirs[`${scenario.name}-offline`], path), 'utf8'), expected, `${scenario.name} offline ${path}`)
    }
    const collected = Object.fromEntries(['baseline', 'candidate', 'offline'].map((kind) => [kind, { cli: [], work: [], cpu: [] }]))
    for (let i = -warmups; i < samples; i++) {
      // Rotate order to share cache, scheduler and temperature effects.
      const order = i % 2 === 0 ? ['baseline', 'candidate', 'offline'] : ['offline', 'candidate', 'baseline']
      for (const kind of order) {
        const result = run(fixtureDirs[`${scenario.name}-${kind}`], kind === 'offline')
        if (i >= 0) for (const metric of ['cli', 'work', 'cpu']) collected[kind][metric].push(result[metric])
      }
    }
    measurements.push({ scenario: scenario.name, repo_count: scenario.repoCount, language_count: scenario.languages.length,
      results: Object.fromEntries(Object.entries(collected).map(([kind, metrics]) => [kind, { cli: summary(metrics.cli), work: summary(metrics.work), cpu: summary(metrics.cpu) }])) })
  }
  console.log(JSON.stringify({ baseline: BASE, runtime: process.version, bun: process.versions.bun ?? null, executable: process.execPath,
    os: `${platform()} ${release()}`, cpu: cpus()[0]?.model, warmups, samples,
    units: 'milliseconds', method: 'Alternating fresh CLI processes with identical local mocked API data; work includes generation, filesystem IO and normal stdout, excluding fixture setup and runtime imports/startup. CPU is process user+system time during work. No network latency. Offline reads the same saved totals and forbids fetch. Two filesystem warmups per mode; each sample has a fresh runtime.',
    empty_process_startup: summary(startup), measurements }, null, 2))
} finally {
  await rm(temp, { recursive: true, force: true })
}
