// scripts/copy-firefox-manifest.js
// Post-build step for `npm run build:firefox`.
// Reads manifest.firefox.json and writes it into dist-firefox/manifest.json.

import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const root = resolve(fileURLToPath(import.meta.url), '../..')

const src  = resolve(root, 'manifest.firefox.json')
const dest = resolve(root, 'dist-firefox', 'manifest.json')

const manifest = JSON.parse(readFileSync(src, 'utf-8'))

// 1. Fix background:
//    - Remove `service_worker` (Firefox ignores it and warns about it)
//    - Point `scripts` at the compiled output: src/background.ts → background.js
delete manifest.background.service_worker
manifest.background.scripts = ['background.js']

// 2. Fix content_scripts: src/content.tsx → content.js
manifest.content_scripts = [
  {
    js: ['content.js'],
    matches: ['<all_urls>'],
  },
]

// 3. data_collection_permissions: omitted intentionally.
//    Firefox requires at least 1 item in "required" if the key is present,
//    so we leave it out entirely (produces a suppressible warning, not an error).

writeFileSync(dest, JSON.stringify(manifest, null, 2))
console.log('✔  dist-firefox/manifest.json written')
