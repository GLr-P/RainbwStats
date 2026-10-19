// Writes the bundled dataset to site/data/meta/latest.json (served by GitHub Pages; the app pulls it).
// Bump BUNDLED_DATASET.version in src/shared/data/dataset.ts before exporting a new one.
import { mkdirSync, writeFileSync } from 'node:fs'
import { BUNDLED_DATASET } from '../src/shared/data/dataset'
import { meta } from '../src/shared/data/meta'

mkdirSync('site/data/meta', { recursive: true })
// The researched meta (site tiers, ranked deltas, pro bans) travels with the dataset.
writeFileSync('site/data/meta/latest.json', JSON.stringify({ ...BUNDLED_DATASET, meta: meta() }) + '\n')
console.log(`exported dataset ${BUNDLED_DATASET.version} with meta ${meta().version}`)
