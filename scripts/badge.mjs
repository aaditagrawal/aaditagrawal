import { FONT, RADIUS, THEMES, textWidth } from './visual-style.mjs'

const xml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const luminance = (rgb) => {
  const [r, g, b] = rgb.map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return r * .2126 + g * .7152 + b * .0722
}
const rgb = (hex) => hex.match(/../g).map((part) => parseInt(part, 16) / 255)

// Preserve the brand hue while lifting dark marks or darkening pale marks.
function logoInk(color, theme) {
  const brand = rgb(color)
  const ink = rgb(theme.primary.slice(1))
  const surface = luminance(rgb(theme.surface.slice(1)))
  for (let step = 0; step <= 20; step++) {
    const mixed = brand.map((v, i) => Math.round((v + (ink[i] - v) * step / 20) * 255))
    const level = luminance(mixed.map((v) => v / 255))
    if ((Math.max(level, surface) + .05) / (Math.min(level, surface) + .05) >= 3) {
      return '#' + mixed.map((v) => v.toString(16).padStart(2, '0')).join('')
    }
  }
  return theme.primary
}

// Self-contained badges: logo paths are vendored, never fetched at render time.
export function renderBadge(label, color, logo) {
  if (typeof label !== 'string' || !label.trim() || /[\u0000-\u001f\u007f]/u.test(label)) {
    throw new Error('Badge label must be nonempty text without control characters')
  }
  if (typeof color !== 'string' || !/^[0-9a-f]{6}$/i.test(color)) {
    throw new Error('Badge color must be six hexadecimal digits')
  }
  if (!logo || typeof logo.path !== 'string' || !/^[Mm][MmLlHhVvCcSsQqTtAaZz0-9eE.,+\s-]+$/u.test(logo.path)) {
    throw new Error('Badge logo must contain only SVG path commands')
  }
  const viewBox = logo.viewBox ?? '0 0 24 24'
  if (typeof viewBox !== 'string' || !/^0 0 [\d.]+ [\d.]+$/.test(viewBox) ||
      !viewBox.split(' ').map(Number).every(Number.isFinite) ||
      viewBox.split(' ').slice(2).some((v) => Number(v) <= 0)) {
    throw new Error('Unsupported badge logo viewBox')
  }
  if (logo.transform !== undefined && (typeof logo.transform !== 'string' ||
      !/^(?:(?:translate|scale)\([\d. +\-]+\)\s*)+$/.test(logo.transform))) {
    throw new Error('Unsupported badge logo transform')
  }
  const width = textWidth(label) + 42
  const light = THEMES.light
  const dark = THEMES.dark
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="28" viewBox="0 0 ${width} 28" role="img" aria-labelledby="title">`,
    `<title id="title">${xml(label)}</title>`,
    `<style>.surface{fill:${light.surface};stroke:${light.border}}.label{fill:${light.primary}}.logo{fill:${logoInk(color, light)}}@media(prefers-color-scheme:dark){.surface{fill:${dark.surface};stroke:${dark.border}}.label{fill:${dark.primary}}.logo{fill:${logoInk(color, dark)}}}</style>`,
    `<rect class="surface" x="0.5" y="0.5" width="${width - 1}" height="27" rx="${RADIUS}"/>`,
    `<svg x="8" y="7" width="14" height="14" viewBox="${viewBox}" aria-hidden="true"><path class="logo"${logo.transform ? ` transform="${logo.transform}"` : ''} d="${logo.path}"/></svg>`,
    `<text class="label" x="30" y="18" font-family="${FONT}" font-size="12" font-weight="500">${xml(label)}</text>`,
    '</svg>\n',
  ].join('\n')
}
