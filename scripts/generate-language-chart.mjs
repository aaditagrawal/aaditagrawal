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
import { FONT, RADIUS, THEMES, textWidth } from './visual-style.mjs'

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

const TOP_N = 8 // categorical slots; everything past this folds into "Other"
const FOOTNOTE_MAX = 7 // languages named in the "Other" footnote before "+N more"

// Validated categorical palette — dataviz skill, slots 1-8 in fixed order.
// Verified with scripts/validate_palette.js against GitHub's own README
// surfaces (#ffffff / #0d1117): all checks pass in both modes. The order is the
// colourblind-safety mechanism, so do not reshuffle it.
const THEME = {
  light: {
    series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
    other: '#898781',
    ...THEMES.light,
  },
  dark: {
    series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
    other: '#898781',
    ...THEMES.dark,
  },
}

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

function wrapText(text, width, size) {
  const lines = []
  let line = ''
  for (const word of text.split(' ')) {
    const next = line ? line + ' ' + word : word
    if (line && textWidth(next, size) > width) {
      lines.push(line)
      line = word
    } else line = next
  }
  if (line) lines.push(line)
  return lines
}

function fitLabel(label, width, size) {
  if (textWidth(label, size) <= width) return label
  const letters = [...label]
  while (letters.length && textWidth(letters.join('') + '…', size) > width) letters.pop()
  return letters.join('') + '…'
}

function renderSvg(segments, meta, mode, compact = false) {
  const c = THEME[mode]
  const colorOf = (seg) => (seg.slot < 0 ? c.other : c.series[seg.slot])
  const width = compact ? 360 : 880
  const cols = compact ? 2 : 3
  const colGap = compact ? 24 : 40
  const colWidth = (width - (cols - 1) * colGap) / cols
  const barY = compact ? 92 : 72
  const barH = 16
  const legendBase = barY + barH + 36
  const rowPitch = 32
  const visible = meta.totalBytes ? segments : []
  const rows = Math.ceil(visible.length / cols)
  const labelSize = compact ? 16 : 15
  const footSize = compact ? 15 : 13
  const other = segments.find((s) => s.slot < 0)
  const named = other ? other.members.slice(0, FOOTNOTE_MAX) : []
  const hidden = other ? other.members.length - named.length : 0
  const footnote = other
    ? 'Other includes ' + named.map((l) => l.name).join(', ') +
      (hidden > 0 ? ', and ' + hidden + ' more.' : '.')
    : ''
  const footLines = wrapText(compact && other ? `Other combines ${other.members.length} more languages.` : footnote, width, footSize)
  const scopeLines = wrapText('Public and private · Forks and archives excluded', width, footSize)
  const footY = legendBase + Math.max(rows, 1) * rowPitch + 4
  const height = footY + (footLines.length + scopeLines.length - 1) * 20 + 8
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="t d">`,
    `<title id="t">Language mix across ${meta.repoCount} repositories</title>`,
    `<desc id="d">${xml(meta.languages.map((l) => l.name + ' ' + pct(l.share)).join(', '))}</desc>`,
    `<style>text{font-family:${FONT};font-variant-numeric:tabular-nums}</style>`,
    `<text x="0" y="24" fill="${c.primary}" font-size="20" font-weight="600">${meta.repoCount} repositories</text>`,
    `<text x="0" y="48" fill="${c.secondary}" font-size="${compact ? 16 : 14}">${mb(meta.totalBytes)} of source · ${meta.languages.length} languages</text>`,
    `<text x="${compact ? 0 : width - 2}" y="${compact ? 72 : 24}" text-anchor="${compact ? 'start' : 'end'}" fill="${c.secondary}" font-size="14">Updated ${xml(meta.date)}</text>`,
    `<clipPath id="bar"><rect x="0" y="${barY}" width="${width}" height="${barH}" rx="${RADIUS}"/></clipPath>`,
    '<g clip-path="url(#bar)">',
    `<rect x="0" y="${barY}" width="${width}" height="${barH}" fill="${c.surface}"/>`,
  ]
  let x = 0
  for (const seg of segments) {
    const w = (seg.share / 100) * width
    if (w > 0) parts.push(`<rect x="${x.toFixed(3)}" y="${barY}" width="${w.toFixed(3)}" height="${barH}" fill="${colorOf(seg)}"/>`)
    x += w
  }
  parts.push('</g>')
  visible.forEach((seg, i) => {
    const cx = (i % cols) * (colWidth + colGap)
    const cy = legendBase + Math.floor(i / cols) * rowPitch
    const label = fitLabel(seg.name, colWidth - 84, labelSize)
    parts.push(
      `<circle cx="${cx + 4}" cy="${cy - 5}" r="4" fill="${colorOf(seg)}"/>`,
      `<text x="${cx + 18}" y="${cy}" fill="${c.secondary}" font-size="${labelSize}">${xml(label)}</text>`,
      `<text x="${cx + colWidth - 2}" y="${cy}" fill="${c.primary}" font-size="${labelSize}" font-weight="600" text-anchor="end">${pct(seg.share)}</text>`,
    )
  })
  if (!meta.totalBytes) parts.push(`<text x="0" y="${legendBase}" fill="${c.secondary}" font-size="14">No source bytes in this snapshot.</text>`)
  footLines.forEach((line, i) => parts.push(`<text x="0" y="${footY + i * 20}" fill="${c.secondary}" font-size="${footSize}">${xml(line)}</text>`))
  scopeLines.forEach((line, i) => parts.push(`<text x="0" y="${footY + (footLines.length + i) * 20}" fill="${c.secondary}" font-size="${footSize}">${xml(line)}</text>`))
  parts.push('</svg>')
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
    `  <source media="(max-width: 600px) and (prefers-color-scheme: dark)" srcset="${RAW}/languages-dark-compact.svg?v=${meta.stamp}">`,
    `  <source media="(max-width: 600px)" srcset="${RAW}/languages-light-compact.svg?v=${meta.stamp}">`,
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
// The chart has a fixed English UTC date, so common-era dates do not need to
// initialize a locale formatter in every fresh CLI process. Keep era formatting
// for ISO snapshots with years outside the common era.
const year = generatedAt.getUTCFullYear()
const date = year > 0
  ? `${generatedAt.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'][generatedAt.getUTCMonth()]} ${year}`
  : generatedAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const meta = { repoCount, totalBytes, languages, date, stamp: generatedAt.toISOString().slice(0, 10) + '-v2' }

for (const mode of ['light', 'dark']) {
  for (const compact of [false, true]) {
    const filename = 'assets/languages-' + mode + (compact ? '-compact' : '') + '.svg'
    await writeFile(resolve(ROOT, filename), renderSvg(segments, meta, mode, compact) + '\n')
  }
}
if (!fromStats) {
  await writeFile(statsPath, JSON.stringify({ generatedAt: stats.generatedAt, repoCount, totalBytes, languages }, null, 2) + '\n')
}
const block = `${START}\n${renderReadmeBlock(languages, meta)}\n${END}`
await writeFile(readmePath, readme.replace(new RegExp(`${START}[\\s\\S]*?${END}`), () => block))

console.log(`${repoCount} repos · ${mb(totalBytes)} · ${languages.length} languages`)
for (const l of languages) console.log(`  ${l.name.padEnd(16)} ${pct(l.share).padStart(7)}  ${l.bytes.toLocaleString('en-US').padStart(11)} B`)
