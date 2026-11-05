const xml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Original text badges. No remote images, fonts or third-party logo artwork.
export function renderBadge(label, color) {
  if (typeof label !== 'string' || !label.trim() || /[\u0000-\u001f\u007f]/u.test(label)) {
    throw new Error('Badge label must be nonempty text without control characters')
  }
  if (typeof color !== 'string' || !/^[0-9a-f]{6}$/i.test(color)) {
    throw new Error('Badge color must be six hexadecimal digits')
  }
  const channels = color.match(/../g).map((hex) => {
    const channel = parseInt(hex, 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  const ink = (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff'
  // A fixed character pitch keeps labels inside the badge across system fonts.
  const textWidth = [...label].length * 7
  const width = textWidth + 16
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" viewBox="0 0 ${width} 20" role="img" aria-labelledby="title">`,
    `<title id="title">${xml(label)}</title>`,
    `<path fill="#${color}" d="M0 0h${width}v20H0z"/>`,
    `<text x="8" y="14" fill="${ink}" font-family="Verdana, Geneva, sans-serif" font-size="11" textLength="${textWidth}" lengthAdjust="spacingAndGlyphs">${xml(label)}</text>`,
    '</svg>\n',
  ].join('\n')
}
