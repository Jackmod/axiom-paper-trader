// Rasterises src/icons/icon.svg into the PNG sizes the manifest requires.
// Run with `npm run icons` after editing the SVG — the PNGs are build output kept in
// git (Chrome needs PNGs, not SVG), and this keeps them regenerable from source instead
// of being binaries nobody can edit.
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import sharp from 'sharp'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(ROOT, 'src/icons/icon.svg')
const SIZES = [16, 48, 128]

const svg = await readFile(SOURCE)

for (const size of SIZES) {
  const png = await sharp(svg, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer()
  const target = join(ROOT, `src/icons/icon-${size}.png`)
  await writeFile(target, png)
  console.log(`icon-${size}.png  ${png.length} bytes`)
}
