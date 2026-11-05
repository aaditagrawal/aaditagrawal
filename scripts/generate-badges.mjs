#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { renderBadge } from './badge.mjs'

const root = new URL('../', import.meta.url)
const badges = JSON.parse(await readFile(new URL('data/badges.json', root), 'utf8'))
const logos = JSON.parse(await readFile(new URL('data/badge-logos.json', root), 'utf8'))
const outputs = Object.entries(badges).map(([id, entry]) => {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || !Array.isArray(entry) || entry.length !== 2) {
    throw new Error(`Invalid badge entry: ${id}`)
  }
  return [new URL(`assets/badges/${id}.svg`, root), renderBadge(...entry, logos.icons[logos.badges[id]])]
})
await mkdir(new URL('assets/badges/', root), { recursive: true })
for (const [path, svg] of outputs) await writeFile(path, svg)
console.log(`Generated ${outputs.length} badges in ${fileURLToPath(new URL('assets/badges/', root))}`)
