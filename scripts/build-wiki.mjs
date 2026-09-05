import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(import.meta.dirname, '..')
const defaultLoreSite = 'C:/Users/pc/Documents/Lore/Lore/site'
const loreSite = path.resolve(process.env.GEOR_LORE_SITE || defaultLoreSite)
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
const wikiConfig = path.join(loreSite, 'mkdocs.yml')
const wikiOutput = path.join(root, 'dist', 'wiki')

if (!existsSync(wikiConfig)) {
  console.error(`Wiki source not found at ${loreSite}. Set GEOR_LORE_SITE to the folder containing mkdocs.yml.`)
  process.exit(1)
}

function run(args, label) {
  const result = spawnSync(python, args, { cwd: root, stdio: 'inherit', env: process.env })
  if (result.error) {
    console.error(`${label} could not start: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) {
    console.error(`${label} failed with exit code ${result.status}.`)
    process.exit(result.status || 1)
  }
}

run([path.join(loreSite, 'generate_nav.py'), '--write'], 'Wiki navigation generation')
run(['-m', 'mkdocs', 'build', '-f', wikiConfig, '--site-dir', wikiOutput], 'MkDocs build')
run([path.join(loreSite, 'optimize_assets.py'), wikiOutput], 'Wiki asset optimization')
run([path.join(root, 'scripts', 'generate-wiki-index.py')], 'Wiki index generation')
run([path.join(root, 'scripts', 'generate_secrets_index.py')], 'Secrets index generation')

