import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { renderBadge } from './badge.mjs'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')
const outputs = ['README.md', 'assets/languages-light.svg', 'assets/languages-dark.svg', 'data/language-stats.json']

async function fixture(run, setup = '', change = async () => {}) {
  const dir = await mkdtemp(join(tmpdir(), 'profile-generators-'))
  try {
    for (const path of ['scripts', 'data', 'assets']) await mkdir(join(dir, path))
    for (const path of [...outputs, 'data/extra-languages.json']) await writeFile(join(dir, path), await read(path))
    const source = (await read('scripts/generate-language-chart.mjs')).replace(/^#![^\n]*\n/, '')
    await writeFile(join(dir, 'scripts/generate-language-chart.mjs'), `${setup}\n${source}`)
    await change(dir)
    const before = await Promise.all(outputs.map((path) => readFile(join(dir, path), 'utf8')))
    const exec = (args, token = '') => spawnSync(process.execPath, [join(dir, 'scripts/generate-language-chart.mjs'), ...args], {
      encoding: 'utf8', env: { ...process.env, GITHUB_TOKEN: token },
    })
    await run({ dir, before, exec, after: () => Promise.all(outputs.map((path) => readFile(join(dir, path), 'utf8'))) })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const noNetwork = 'globalThis.fetch = () => { throw new Error("Network access forbidden") }'

test('offline mode needs neither a token nor network and reproduces the saved assets exactly', async () => {
  await fixture(async ({ exec, before, after }) => {
    const result = exec(['--from-stats'])
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(await after(), before)
  }, noNetwork)
})

test('invalid snapshots fail before writing any outputs', async () => {
  const invalid = [
    (stats) => { stats.generatedAt = 'not a date' },
    (stats) => { stats.repoCount = -1 },
    (stats) => { stats.totalBytes += 1 },
    (stats) => { stats.languages[0].bytes = -1 },
    (stats) => { stats.languages[0].share = 99 },
    (stats) => { stats.languages[1].name = stats.languages[0].name },
    (stats) => { stats.languages.reverse() },
    (stats) => { stats.languages[0].name = '\u0000' },
  ]
  for (const change of invalid) {
    await fixture(async ({ exec, before, after }) => {
      const result = exec(['--from-stats'])
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /Invalid language statistics snapshot/)
      assert.deepEqual(await after(), before)
    }, noNetwork, async (dir) => {
      const stats = JSON.parse(await read('data/language-stats.json'))
      change(stats)
      await writeFile(join(dir, 'data/language-stats.json'), JSON.stringify(stats))
    })
  }
})

test('missing, reversed and duplicate README markers fail before writing', async () => {
  for (const readme of ['no markers', '<!-- LANG-CHART:END --><!-- LANG-CHART:START -->',
    '<!-- LANG-CHART:START --><!-- LANG-CHART:END --><!-- LANG-CHART:END -->']) {
    await fixture(async ({ exec, before, after }) => {
      const result = exec(['--from-stats'])
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /ordered pair/)
      assert.deepEqual(await after(), before)
    }, noNetwork, (dir) => writeFile(join(dir, 'README.md'), readme))
  }
})

test('help, unknown options and missing online token never write or fetch', async () => {
  await fixture(async ({ exec, before, after }) => {
    assert.equal(exec(['--help']).status, 0)
    assert.match(exec(['--help']).stdout, /--from-stats/)
    assert.notEqual(exec(['--unknown']).status, 0)
    assert.match(exec([]).stderr, /GITHUB_TOKEN is required/)
    assert.deepEqual(await after(), before)
  }, noNetwork)
})

test('offline language labels are escaped in both SVG and README HTML', async () => {
  await fixture(async ({ exec, after }) => {
    const result = exec(['--from-stats'])
    assert.equal(result.status, 0, result.stderr)
    const [readme, light, dark] = await after()
    for (const text of [readme, light, dark]) assert.ok(text.includes('A&quot;&lt;&amp; 100.00%'))
  }, noNetwork, (dir) => writeFile(join(dir, 'data/language-stats.json'), JSON.stringify({
    generatedAt: '2026-08-19T14:31:09.883Z', repoCount: 1, totalBytes: 4,
    languages: [{ name: 'A"<&', bytes: 4, share: 100 }],
  })))
})

test('online refresh still paginates, excludes forks and archives, and includes extras', async () => {
  const page = Array.from({ length: 100 }, (_, i) => ({ name: `repo${i}`, full_name: `owner/repo${i}`, fork: i > 1, archived: i === 1 }))
  const responses = {
    '/user/repos?affiliation=owner&per_page=100&page=1': page,
    '/user/repos?affiliation=owner&per_page=100&page=2': [{ name: 'last', full_name: 'owner/last', fork: false, archived: false }],
    '/repos/owner/repo0/languages': { TypeScript: 100, Python: 20 },
    '/repos/owner/last/languages': { Python: 30 },
  }
  const mock = `const responses = ${JSON.stringify(responses)}; globalThis.fetch = async (url, options) => {
    if (options.headers.Authorization !== 'Bearer fixture-token') throw new Error('Missing authorization');
    const path = String(url).replace('https://api.github.com', '');
    if (!Object.hasOwn(responses, path)) throw new Error('Unexpected request: ' + path);
    return { ok: true, json: async () => responses[path] };
  }`
  await fixture(async ({ exec, before, after }) => {
    const result = exec([], 'fixture-token')
    assert.equal(result.status, 0, result.stderr)
    const resultFiles = await after()
    const stats = JSON.parse(resultFiles[3])
    assert.equal(stats.repoCount, 3)
    assert.equal(stats.totalBytes, 200)
    assert.deepEqual(stats.languages, [
      { name: 'TypeScript', bytes: 100, share: 50 },
      { name: 'Python', bytes: 100, share: 50 },
    ])
    assert.notEqual(resultFiles[0], before[0])
    assert.ok(!resultFiles.join('').includes('fixture-token'))
  }, mock, (dir) => writeFile(join(dir, 'data/extra-languages.json'), JSON.stringify({ repos: { outside: { languages: { Python: 50 } } } })))
})

test('HTTP errors leave existing chart outputs intact', async () => {
  await fixture(async ({ exec, before, after }) => {
    const result = exec([], 'fixture-token')
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /403/)
    assert.ok(!result.stderr.includes('fixture-token'))
    assert.deepEqual(await after(), before)
  }, 'globalThis.fetch = async () => ({ ok: false, status: 403, text: async () => "Forbidden" })')
})

test('all local badges match the generator, keep accessible titles, and need no remote resources', async () => {
  const badges = JSON.parse(await read('data/badges.json'))
  const references = new Set()
  for (const path of ['README.md', 'TECH_STACK.md']) {
    const markdown = await read(path)
    assert.ok(!markdown.includes('img.shields.io'))
    for (const match of markdown.matchAll(/!\[[^\]]+\]\(assets\/badges\/([a-z0-9-]+)\.svg\)/g)) references.add(match[1])
  }
  assert.deepEqual([...references].sort(), Object.keys(badges).sort())
  assert.deepEqual((await readdir(new URL('assets/badges/', root))).sort(), [...references].map((id) => `${id}.svg`).sort())
  for (const [id, [label, color]] of Object.entries(badges)) {
    const svg = await read(`assets/badges/${id}.svg`)
    assert.equal(svg, renderBadge(label, color), id)
    assert.match(svg, /role="img" aria-labelledby="title"/)
    assert.ok(!/(?:href=|<script|<image|@import|url\()/i.test(svg), id)
    const rgb = color.match(/../g).map((part) => parseInt(part, 16) / 255)
    const linear = rgb.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
    const contrast = svg.includes('fill="#000000" font-family') ? (luminance + 0.05) / 0.05 : 1.05 / (luminance + 0.05)
    assert.ok(contrast >= 4.5, `${id}: ${contrast}`)
  }
})

test('badge renderer escapes markup and rejects unsafe label/color inputs', () => {
  const svg = renderBadge('A"<&>', 'FFFFFF')
  assert.match(svg, /A&quot;&lt;&amp;&gt;/)
  for (const label of ['', ' ', '\u0000', null]) assert.throws(() => renderBadge(label, 'FFFFFF'))
  for (const color of ['', '#FFFFFF', 'red', '" onload="alert(1)', null]) assert.throws(() => renderBadge('A', color))
})
