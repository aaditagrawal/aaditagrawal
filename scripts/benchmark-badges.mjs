#!/usr/bin/env bun
// Baseline assets are benchmark-only fixtures outside the repository.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir, cpus, platform, arch } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const root = fileURLToPath(new URL('../', import.meta.url))
const baselineRef = process.env.BASELINE_REF ?? 'b40edbddbc620d7f78096231fe66309ce795590c'
const browser = process.env.BROWSER_BIN ?? 'google-chrome'
const samples = Number(process.env.SAMPLES ?? 21)
assert.ok(Number.isInteger(samples) && samples >= 5, 'SAMPLES must be at least 5')
const cache = resolve(process.env.BADGE_BENCH_CACHE ?? join(tmpdir(), 'aaditagrawal-badge-baseline'))
await mkdir(cache, { recursive: true })
const pairs = []
for (const file of ['README.md', 'TECH_STACK.md']) {
  const before = execFileSync('git', ['show', `${baselineRef}:${file}`], { cwd: root, encoding: 'utf8' })
  const after = await readFile(join(root, file), 'utf8')
  const pattern = /\[!\[([^\]]*)\]\(([^)]+)\)\]\(([^)]+)\)/g
  const originals = [...before.matchAll(pattern)].filter((match) => match[2].startsWith('https://img.shields.io/'))
  const replacements = [...after.matchAll(pattern)].filter((match) => match[2].startsWith('assets/badges/'))
  assert.equal(originals.length, replacements.length)
  for (let i = 0; i < originals.length; i++) {
    assert.equal(originals[i][1], replacements[i][1])
    assert.equal(originals[i][3], replacements[i][3])
    pairs.push({ url: originals[i][2], path: replacements[i][2] })
  }
}
let next = 0
const baseline = new Array(pairs.length)
const candidate = new Array(pairs.length)
const downloads = []
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < pairs.length) {
    const index = next++
    const pair = pairs[index]
    const cached = join(cache, `${createHash('sha256').update(pair.url).digest('hex')}.svg`)
    try { baseline[index] = await readFile(cached) } catch (error) {
      if (error.code !== 'ENOENT') throw error
      const start = performance.now()
      const response = await fetch(pair.url, { signal: AbortSignal.timeout(30000) })
      assert.ok(response.ok, `${response.status}: ${pair.url}`)
      baseline[index] = Buffer.from(await response.arrayBuffer())
      assert.match(baseline[index].toString(), /^<svg[\s>]/)
      downloads.push(performance.now() - start)
      await writeFile(cached, baseline[index])
    }
    candidate[index] = await readFile(join(root, pair.path))
  }
}))
const asUrls = (buffers) => buffers.map((buffer) => `data:image/svg+xml;base64,${buffer.toString('base64')}`)
const fixture = await mkdtemp(join(tmpdir(), 'profile-badge-bench-'))
try {
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0}#host{width:900px}img{vertical-align:middle;margin:2px}</style><div id="host"></div><pre id="results"></pre><script>
  const encoded = ${JSON.stringify({ baseline: asUrls(baseline), candidate: asUrls(candidate) })};
  // Equal-length blob URLs avoid charging the baseline for data-URL DOM parsing.
  const sources = Object.fromEntries(Object.entries(encoded).map(([name, urls]) => [name, urls.map(src =>
    URL.createObjectURL(new Blob([Uint8Array.from(atob(src.split(',')[1]), c => c.charCodeAt(0))], {type:'image/svg+xml'})))]));
  const samples = ${samples};
  async function main() {
    const decoded = {}, decodeMs = {};
    for (const name of ['baseline', 'candidate']) {
      const start = performance.now();
      decoded[name] = await Promise.all(sources[name].map(async (src) => {
        const image = new Image(); image.src = src; await image.decode(); return image;
      }));
      decodeMs[name] = performance.now() - start;
    }
    const host = document.querySelector('#host');
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 512;
    const ctx = canvas.getContext('2d', {willReadFrequently: true});
    const series = [];
    for (const count of [5, sources.baseline.length, sources.baseline.length * 10]) {
      const repetitions = count === 5 ? 10 : 1;
      const markup = Object.fromEntries(Object.keys(sources).map(name => [name,
        Array.from({length: count}, (_, i) => '<img alt="badge" src="' + sources[name][i % sources[name].length] + '">').join(' ')]));
      const run = name => {
        const start = performance.now();
        for (let repeat = 0; repeat < repetitions; repeat++) {
          host.innerHTML = markup[name];
          void host.offsetHeight;
          for (let i = 0; i < count; i++) ctx.drawImage(decoded[name][i % decoded[name].length], i % 5 * 200, Math.floor(i / 5) % 24 * 21);
          ctx.getImageData(0, 0, 1, 1);
          host.replaceChildren();
        }
        return (performance.now() - start) / repetitions;
      };
      for (let i = 0; i < 4; i++) { run('baseline'); run('candidate'); }
      const timings = {baseline: [], candidate: []};
      for (let i = 0; i < samples; i++) {
        for (const name of i % 2 ? ['candidate','baseline'] : ['baseline','candidate']) timings[name].push(run(name));
      }
      series.push({count, repetitions, timings});
    }
    return {decodeMs, series};
  }
  </script>`
  const file = join(fixture, 'benchmark.html')
  await writeFile(file, html)
  const start = performance.now()
  const chrome = spawn(browser, ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--disable-extensions', '--disable-background-networking', '--remote-debugging-port=0',
    `--user-data-dir=${join(fixture, 'chrome')}`, '--no-first-run', '--no-default-browser-check',
    `file://${file}`], { stdio: 'ignore' })
  let result, browserWallMs
  try {
    let port
    for (let attempt = 0; attempt < 300; attempt++) {
      try { port = (await readFile(join(fixture, 'chrome/DevToolsActivePort'), 'utf8')).split('\n')[0]; break } catch (error) {
        if (error.code !== 'ENOENT') throw error
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }
    assert.ok(port, 'Chrome did not open its local debugging endpoint')
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    const page = pages.find(page => page.url === `file://${file}`)
    assert.ok(page, 'Benchmark page missing')
    const socket = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
    const response = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Browser benchmark exceeded 120 seconds')), 120000)
      socket.onmessage = ({data}) => {
        const message = JSON.parse(data)
        if (message.id === 1) {
          if (message.result?.result?.value === null || message.error?.message?.includes('context')) {
            setTimeout(evaluate, 100)
          } else { clearTimeout(timer); resolve(message) }
        }
      }
      const evaluate = () => socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: {
        expression: 'typeof main === "function" ? main() : null', awaitPromise: true, returnByValue: true,
      } }))
      evaluate()
    })
    socket.close()
    assert.ok(!response.error && !response.result.exceptionDetails, JSON.stringify(response))
    result = response.result.result.value
    browserWallMs = performance.now() - start
  } finally {
    chrome.kill()
    await new Promise(resolve => chrome.once('exit', resolve))
  }
  const summary = (values) => {
    const sorted = [...values].sort((a, b) => a - b)
    return { median: sorted[Math.floor(sorted.length / 2)], p25: sorted[Math.floor(sorted.length * .25)],
      p75: sorted[Math.floor(sorted.length * .75)], p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))] }
  }
  console.log(JSON.stringify({ baselineRef, runtime: process.version, browser: execFileSync(browser, ['--version'], {encoding:'utf8'}).trim(),
    platform: `${platform()} ${arch()}`, cpu: cpus()[0].model, samples, warmups: 4, browserWallMs,
    method: 'Same browser, predecoded SVG images, alternating order, DOM creation/layout plus canvas draw/readback per sample. No network in timed render. Small batches amortize clock resolution. Decode/startup/network are separate, not parity claims.',
    payloadBytes: {baseline: baseline.reduce((sum, buffer) => sum + buffer.length, 0), candidate: candidate.reduce((sum, buffer) => sum + buffer.length, 0)},
    gzipBytes: {baseline: baseline.reduce((sum, buffer) => sum + gzipSync(buffer).length, 0), candidate: candidate.reduce((sum, buffer) => sum + gzipSync(buffer).length, 0)},
    networkFixtureAcquisition: {samples: downloads.length, milliseconds: downloads.length ? summary(downloads) : null},
    decodeMs: result.decodeMs,
    workloads: result.series.map(({count, repetitions, timings}) => ({count, repetitions, baselineMs: summary(timings.baseline), candidateMs: summary(timings.candidate), timings})),
  }, null, 2))
} finally {
  await rm(fixture, {recursive: true, force: true})
}
