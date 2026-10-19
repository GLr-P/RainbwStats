// Writes the bundled dataset to site/data/meta/latest.json (served by GitHub Pages; the app pulls it).
// Bump BUNDLED_DATASET.version in src/shared/data/dataset.ts before exporting a new one.
import { mkdirSync, writeFileSync } from 'node:fs'
import { BUNDLED_DATASET } from '../src/shared/data/dataset'

mkdirSync('site/data/meta', { recursive: true })
writeFileSync('site/data/meta/latest.json', JSON.stringify(BUNDLED_DATASET, null, 1) + '\n')
console.log(`exported dataset ${BUNDLED_DATASET.version}`)
