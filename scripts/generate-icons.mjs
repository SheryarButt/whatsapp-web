#!/usr/bin/env node
/**
 * Generate the app icon set as PNGs, with no image-library dependency.
 *
 * electron-builder wants a directory of <N>x<N>.png files, and the tray needs a
 * small one. Committing the generator alongside the output keeps the icon
 * editable — a binary blob with no source is not.
 *
 *   node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icons')
const SIZES = [16, 22, 24, 32, 48, 64, 128, 256, 512]

// --- PNG encoding ----------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = ~0
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return ~c >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // adaptive filtering
  ihdr[12] = 0 // no interlace

  // Each scanline is prefixed with its filter type (0 = None).
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// --- shape sampling (coordinates are 0..1) ---------------------------------

const GREEN = [0x25, 0xd3, 0x66]
const WHITE = [0xff, 0xff, 0xff]

function insideRoundedSquare(x, y, radius) {
  const dx = Math.max(Math.abs(x - 0.5) - (0.5 - radius), 0)
  const dy = Math.max(Math.abs(y - 0.5) - (0.5 - radius), 0)
  return Math.hypot(dx, dy) <= radius
}

function insideTriangle(px, py, [ax, ay], [bx, by], [cx, cy]) {
  const sign = (x1, y1, x2, y2, x3, y3) => (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3)
  const d1 = sign(px, py, ax, ay, bx, by)
  const d2 = sign(px, py, bx, by, cx, cy)
  const d3 = sign(px, py, cx, cy, ax, ay)
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}

/** A white chat bubble on a green rounded square — legible down to 16px. */
function sample(x, y) {
  if (!insideRoundedSquare(x, y, 0.22)) return [0, 0, 0, 0]

  const inBubble = Math.hypot(x - 0.5, y - 0.46) <= 0.27
  const inTail = insideTriangle(x, y, [0.34, 0.62], [0.28, 0.82], [0.52, 0.66])

  return inBubble || inTail ? [...WHITE, 1] : [...GREEN, 1]
}

function render(size) {
  const SS = 4 // supersampling factor, for antialiased edges
  const out = Buffer.alloc(size * size * 4)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [sr, sg, sb, sa] = sample((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size)
          r += sr * sa
          g += sg * sa
          b += sb * sa
          a += sa
        }
      }
      const i = (y * size + x) * 4
      if (a > 0) {
        out[i] = Math.round(r / a) // un-premultiply
        out[i + 1] = Math.round(g / a)
        out[i + 2] = Math.round(b / a)
      }
      out[i + 3] = Math.round((a / (SS * SS)) * 255)
    }
  }
  return out
}

mkdirSync(OUT_DIR, { recursive: true })
for (const size of SIZES) {
  const file = join(OUT_DIR, `${size}x${size}.png`)
  writeFileSync(file, encodePng(size, render(size)))
  console.log(`wrote ${file}`)
}
