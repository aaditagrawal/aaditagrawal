import { FONT, RADIUS, THEMES, textWidth } from './visual-style.mjs'

const xml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Original text badges. No remote images, fonts or third-party logo artwork.
export function renderBadge(label, color) {
  if (typeof label !== 'string' || !label.trim() || /[\u0000-\u001f\u007f]/u.test(label)) {
    throw new Error('Badge label must be nonempty text without control characters')
  }
  if (typeof color !== 'string' || !/^[0-9a-f]{6}$/i.test(color)) {
    throw new Error('Badge color must be six hexadecimal digits')
  }
  const width = textWidth(label) + 36
  const light = THEMES.light
  const dark = THEMES.dark
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="28" viewBox="0 0 ${width} 28" role="img" aria-labelledby="title">`,
    `<title id="title">${xml(label)}</title>`,
    `<style>.surface{fill:${light.surface};stroke:${light.border}}.label{fill:${light.primary}}.marker{stroke:${light.border}}@media(prefers-color-scheme:dark){.surface{fill:${dark.surface};stroke:${dark.border}}.label{fill:${dark.primary}}.marker{stroke:${dark.border}}}</style>`,
    `<rect class="surface" x="0.5" y="0.5" width="${width - 1}" height="27" rx="${RADIUS}"/>`,
    `<circle class="marker" cx="12" cy="14" r="3.5" fill="#${color}" stroke-width="0.5"/>`,
    `<text class="label" x="24" y="18" font-family="${FONT}" font-size="12" font-weight="500">${xml(label)}</text>`,
    '</svg>\n',
  ].join('\n')
}
