import fs from 'node:fs'
import path from 'node:path'
import type { ImageStyleManifest } from '@big-ppt/shared'

/** Complete, decoder-valid 1x1 transparent PNG. */
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

export interface WriteImageStyleFixtureOptions {
  manifest?: Partial<ImageStyleManifest> & Record<string, unknown>
  previewBytes?: Buffer | null
  referenceBytes?: Buffer | null
}

export function buildImageStyleManifest(
  id: string,
  overrides: WriteImageStyleFixtureOptions['manifest'] = {},
): ImageStyleManifest {
  return {
    schemaVersion: 1,
    id,
    name: `${id} 名称`,
    description: `${id} fixture description`,
    category: 'illustration',
    tags: ['fixture', id],
    order: 10,
    stylePrompt: `private prompt for ${id}`,
    palettePolicy: 'template',
    previewImage: 'preview.png',
    references: [{ file: 'reference.png', width: 1, height: 1 }],
    ...overrides,
  } as ImageStyleManifest
}

export function writeImageStyleFixture(
  imageStylesRoot: string,
  id: string,
  options: WriteImageStyleFixtureOptions = {},
): { dir: string; manifest: ImageStyleManifest } {
  const dir = path.join(imageStylesRoot, id)
  fs.mkdirSync(dir, { recursive: true })
  const manifest = buildImageStyleManifest(id, options.manifest)
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))

  if (options.previewBytes !== null) {
    fs.writeFileSync(path.join(dir, manifest.previewImage), options.previewBytes ?? PNG_1X1)
  }
  if (options.referenceBytes !== null) {
    for (const reference of manifest.references) {
      fs.writeFileSync(path.join(dir, reference.file), options.referenceBytes ?? PNG_1X1)
    }
  }
  return { dir, manifest }
}
