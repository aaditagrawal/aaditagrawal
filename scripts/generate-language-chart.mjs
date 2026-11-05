#!/usr/bin/env node
// Regenerates the language-mix chart on the profile README.
//
// Counts source bytes per language across every repo I own, as classified by
// GitHub Linguist (so lockfiles, vendored code, JSON and prose are already out).
// Forks are excluded — they are other people's code. Archived repos are excluded
// too, which is what keeps the three telemachus snapshots from counting Swift
// three times. Repos that live outside GitHub go in data/extra-languages.json.
//
// Run by hand whenever the mix is worth refreshing:
//
//   GITHUB_TOKEN=... bun scripts/generate-language-chart.mjs
// Or render the saved snapshot without credentials or network access:
//   bun scripts/generate-language-chart.mjs --from-stats

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TOKEN = process.env.GITHUB_TOKEN
const args = process.argv.slice(2)
if (args.length === 1 && args[0] === '--help') {
  console.log('Usage: bun scripts/generate-language-chart.mjs [--from-stats]\nDefault: refresh from GitHub using GITHUB_TOKEN. --from-stats: render data/language-stats.json offline.')
  process.exit(0)
}
if (args.length > 1 || (args.length === 1 && args[0] !== '--from-stats')) {
  throw new Error('Usage: bun scripts/generate-language-chart.mjs [--from-stats]')
}
const fromStats = args[0] === '--from-stats'
if (!fromStats && !TOKEN) throw new Error('GITHUB_TOKEN is required (needs repo scope to see private repos)')

const WIDTH = 880
const TOP_N = 8 // categorical slots; everything past this folds into "Other"
const LEGEND_COLS = 3
const FOOTNOTE_MAX = 7 // languages named in the "Other" footnote before "+N more"

// Validated categorical palette — dataviz skill, slots 1-8 in fixed order.
// Verified with scripts/validate_palette.js against GitHub's own README
// surfaces (#ffffff / #0d1117): all checks pass in both modes. The order is the
// colourblind-safety mechanism, so do not reshuffle it.
const THEME = {
  light: {
    series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
    other: '#898781',
    primary: '#0b0b0b',
    secondary: '#52514e',
    muted: '#898781',
    onFill: '#ffffff',
  },
  dark: {
    series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
    other: '#898781',
    primary: '#ffffff',
    secondary: '#c3c2b7',
    muted: '#898781',
    onFill: '#ffffff',
  },
}

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif'

const xml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'aaditagrawal-language-chart',
    },
  })
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${await res.text()}`)
  return res.json()
}

async function collect() {
  const repos = []
  for (let page = 1; ; page++) {
    const batch = await gh(`/user/repos?affiliation=owner&per_page=100&page=${page}`)
    repos.push(...batch)
    if (batch.length < 100) break
  }

  const counted = repos.filter((r) => !r.fork && !r.archived)
  const totals = new Map()
  const add = (lang, bytes) => totals.set(lang, (totals.get(lang) ?? 0) + bytes)

  // Linguist byte counts are per-repo, so these are independent requests.
  const perRepo = await Promise.all(
    counted.map(async (r) => [r.name, await gh(`/repos/${r.full_name}/languages`)]),
  )
  for (const [, langs] of perRepo) for (const [lang, bytes] of Object.entries(langs)) add(lang, bytes)

  const extraFile = JSON.parse(await readFile(resolve(ROOT, 'data/extra-languages.json'), 'utf8'))
  const extras = Object.entries(extraFile.repos ?? {})
  for (const [, entry] of extras) for (const [lang, bytes] of Object.entries(entry.languages)) add(lang, bytes)

  const totalBytes = [...totals.values()].reduce((a, b) => a + b, 0)
  const languages = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, bytes]) => ({ name, bytes, share: (bytes / totalBytes) * 100 }))

  return { languages, totalBytes, repoCount: counted.length + extras.length }
}

function validateStats(stats) {
  const invalid = () => { throw new Error('Invalid language statistics snapshot') }
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) invalid()
  const { generatedAt, repoCount, totalBytes, languages } = stats
  if (typeof generatedAt !== 'string' || !Number.isFinite(Date.parse(generatedAt)) ||
      new Date(generatedAt).toISOString() !== generatedAt ||
      !Number.isSafeInteger(repoCount) || repoCount < 0 ||
      !Number.isSafeInteger(totalBytes) || totalBytes < 0 || !Array.isArray(languages)) invalid()
  const names = new Set()
  let sum = 0
  let previous = Infinity
  for (const language of languages) {
    if (!language || typeof language !== 'object') invalid()
    const { name, bytes, share } = language
    if (typeof name !== 'string' || !name.trim() || /[\u0000-\u001f\u007f]/u.test(name) || names.has(name) ||
        !Number.isSafeInteger(bytes) || bytes < 0 || bytes > previous ||
        !Number.isFinite(share) || share < 0 || share > 100 ||
        Math.abs(share - (totalBytes ? bytes / totalBytes * 100 : 0)) > 1e-8) invalid()
    names.add(name)
    previous = bytes
    sum += bytes
  }
  if (sum !== totalBytes) invalid()
  return stats
}

// The bar shows TOP_N coloured segments plus one grey "Other".
// The image alt text lists every language; the legend summarizes the rest.
function segmentsOf(languages) {
  const top = languages.slice(0, TOP_N)
  const rest = languages.slice(TOP_N)
  const segments = top.map((l, i) => ({ ...l, slot: i }))
  if (rest.length) {
    segments.push({
      name: 'Other',
      bytes: rest.reduce((a, l) => a + l.bytes, 0),
      share: rest.reduce((a, l) => a + l.share, 0),
      slot: -1,
      members: rest,
    })
  }
  return segments
}

const pct = (n) => `${n.toFixed(2)}%`
const mb = (b) => `${(b / 1e6).toFixed(2)} MB`

function renderSvg(segments, meta, mode) {
  const c = THEME[mode]
  const colorOf = (seg) => (seg.slot < 0 ? c.other : c.series[seg.slot])

  const barY = 52
  const barH = 22
  const gap = 2 // surface gap between stacked segments
  const rows = Math.ceil(segments.length / LEGEND_COLS)
  const colPitch = WIDTH / LEGEND_COLS
  const legendBase = 104
  const rowPitch = 24

  const other = segments.find((s) => s.slot < 0)
  const named = other ? other.members.slice(0, FOOTNOTE_MAX) : []
  const hidden = other ? other.members.length - named.length : 0
  const footnote = other
    ? `Other: ${named.map((l) => `${l.name} ${pct(l.share)}`).join('  ·  ')}` +
      (hidden > 0 ? `  ·  and ${hidden} more` : '')
    : ''
  const footY = legendBase + rows * rowPitch + 2
  const height = footY + 12

  const parts = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-labelledby="t d">`,
    `<title id="t">Language mix across ${meta.repoCount} repositories</title>`,
    `<desc id="d">${xml(meta.languages.map((l) => `${l.name} ${pct(l.share)}`).join(', '))}</desc>`,
    `<style>text{font-family:${FONT}}</style>`,
    `<text x="0" y="16" fill="${c.primary}" font-size="15" font-weight="600">Language mix</text>`,
    `<text x="0" y="36" fill="${c.muted}" font-size="11">${xml(meta.subtitle)}</text>`,
    `<clipPath id="bar"><rect x="0" y="${barY}" width="${WIDTH}" height="${barH}" rx="4"/></clipPath>`,
    `<g clip-path="url(#bar)">`,
  )

  let x = 0
  for (const seg of segments) {
    const w = (seg.share / 100) * WIDTH
    parts.push(
      `<rect x="${x.toFixed(2)}" y="${barY}" width="${Math.max(w - gap, 0.5).toFixed(2)}" height="${barH}" fill="${colorOf(seg)}"/>`,
    )
    // Direct-label only where the value fits inside the segment with padding;
    // interior segments too narrow for it lean on the legend instead.
    const label = pct(seg.share)
    if (w - gap > label.length * 7 + 20) {
      parts.push(
        `<text x="${(x + 10).toFixed(2)}" y="${barY + 15}" fill="${c.onFill}" font-size="11" font-weight="600">${label}</text>`,
      )
    }
    x += w
  }
  parts.push(`</g>`)

  segments.forEach((seg, i) => {
    const cx = (i % LEGEND_COLS) * colPitch
    const cy = legendBase + Math.floor(i / LEGEND_COLS) * rowPitch
    parts.push(
      `<rect x="${cx}" y="${cy - 9}" width="9" height="9" rx="2" fill="${colorOf(seg)}"/>`,
      `<text x="${cx + 16}" y="${cy}" fill="${c.secondary}" font-size="12">${xml(seg.name)}</text>`,
      `<text x="${cx + colPitch - 34}" y="${cy}" fill="${c.primary}" font-size="12" font-weight="600" text-anchor="end" style="font-variant-numeric:tabular-nums">${pct(seg.share)}</text>`,
    )
  })

  if (footnote) {
    parts.push(`<text x="0" y="${footY}" fill="${c.muted}" font-size="10">${xml(footnote)}</text>`)
  }
  parts.push(`</svg>`)
  return parts.join('\n')
}

// Absolute raw URLs rather than relative paths: GitHub rewrites relative `src`
// on <img>, but <source srcset> is less certain, and a half-resolved <picture>
// would silently break dark mode. The ?v= stamp busts GitHub's camo image cache
// so a refreshed chart shows up immediately instead of serving last week's.
const RAW = 'https://raw.githubusercontent.com/aaditagrawal/aaditagrawal/main/assets'

function renderReadmeBlock(languages, meta) {
  // The alt text spells out every language, not just the nine the bar colours in.
  // With no table on the page it is the only textual form of the data, so the
  // long tail has to live here or it lives nowhere.
  const alt = languages.map((l) => `${l.name} ${pct(l.share)}`).join(', ')
  return [
    '<picture>',
    `  <source media="(prefers-color-scheme: dark)" srcset="${RAW}/languages-dark.svg?v=${meta.stamp}">`,
    `  <img alt="Language mix across ${meta.repoCount} repositories — ${xml(alt)}" src="${RAW}/languages-light.svg?v=${meta.stamp}">`,
    '</picture>',
  ].join('\n')
}

const readmePath = resolve(ROOT, 'README.md')
const readme = await readFile(readmePath, 'utf8')
const START = '<!-- LANG-CHART:START -->'
const END = '<!-- LANG-CHART:END -->'
const start = readme.indexOf(START)
const end = readme.indexOf(END)
if (start < 0 || end < start || readme.lastIndexOf(START) !== start || readme.lastIndexOf(END) !== end) {
  throw new Error(`README.md needs one ordered pair of ${START} / ${END} markers`)
}
const statsPath = resolve(ROOT, 'data/language-stats.json')
const stats = fromStats
  ? validateStats(JSON.parse(await readFile(statsPath, 'utf8')))
  : { ...await collect(), generatedAt: new Date().toISOString() }
const { languages, totalBytes, repoCount } = stats
const segments = segmentsOf(languages)
const generatedAt = new Date(stats.generatedAt)
const subtitle =
  `${mb(totalBytes)} of source across ${repoCount} repositories  ·  public and private, forks and archives excluded  ·  ` +
  generatedAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const meta = { repoCount, totalBytes, subtitle, languages, stamp: generatedAt.toISOString().slice(0, 10) }

await writeFile(resolve(ROOT, 'assets/languages-light.svg'), renderSvg(segments, meta, 'light') + '\n')
await writeFile(resolve(ROOT, 'assets/languages-dark.svg'), renderSvg(segments, meta, 'dark') + '\n')
if (!fromStats) {
  await writeFile(statsPath, JSON.stringify({ generatedAt: stats.generatedAt, repoCount, totalBytes, languages }, null, 2) + '\n')
}
const block = `${START}\n${renderReadmeBlock(languages, meta)}\n${END}`
await writeFile(readmePath, readme.replace(new RegExp(`${START}[\\s\\S]*?${END}`), () => block))

console.log(`${repoCount} repos · ${mb(totalBytes)} · ${languages.length} languages`)
for (const l of languages) console.log(`  ${l.name.padEnd(16)} ${pct(l.share).padStart(7)}  ${l.bytes.toLocaleString('en-US').padStart(11)} B`)
