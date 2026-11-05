// Shared by the badge and language-chart SVGs. No downloaded fonts.
export const FONT = 'Arial, Helvetica, sans-serif'
export const RADIUS = 6
export const THEMES = {
  light: { surface: '#f6f8fa', border: '#d0d7de', primary: '#24292f', secondary: '#57606a' },
  dark: { surface: '#161b22', border: '#30363d', primary: '#e6edf3', secondary: '#9da7b3' },
}

// Arial glyph advances at 12px, rounded up from browser font metrics.
// Reserve fallback-font room without stretching/compressing the rendered text.
const ADVANCES = [
  3.34, 3.34, 4.26, 6.68, 6.68, 10.67, 8.01, 2.3, 4, 4, 4.67, 7.01, 3.34, 4, 3.34, 3.34,
  6.68, 6.68, 6.68, 6.68, 6.68, 6.68, 6.68, 6.68, 6.68, 6.68, 3.34, 3.34, 7.01, 7.01, 7.01, 6.68,
  12.19, 8.01, 8.01, 8.67, 8.67, 8.01, 7.34, 9.34, 8.67, 3.34, 6, 8.01, 6.68, 10, 8.67, 9.34,
  8.01, 9.34, 8.67, 8.01, 7.34, 8.67, 8.01, 11.33, 8.01, 8.01, 7.34, 3.34, 3.34, 3.34, 5.64, 6.68,
  4, 6.68, 6.68, 6, 6.68, 6.68, 3.34, 6.68, 6.68, 2.67, 2.67, 6, 2.67, 10, 6.68, 6.68,
  6.68, 6.68, 4, 6, 3.34, 6.68, 6, 8.67, 6, 6, 6, 4.01, 3.12, 4.01, 7.01,
]
export function textWidth(text, size = 12) {
  return Math.ceil([...text].reduce((sum, letter) =>
    sum + (ADVANCES[letter.codePointAt(0) - 32] ?? 12) + 0.2, 0) * size / 12)
}
