import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const vault = process.env.GEOR_LORE_VAULT || path.dirname(process.env.GEOR_LORE_SITE || 'C:/Users/pc/Documents/Lore/Lore/site')
if (!existsSync(path.join(vault, 'World'))) {
  console.error('Lore vault not found. Set GEOR_LORE_VAULT to the folder containing World/.')
  process.exit(1)
}
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
for (const name of ['timeline', 'calendar', 'tags', 'gazetteer', 'trees', 'webs', 'gallery', 'statblocks', 'search_extra']) {
  const result = spawnSync(python, [path.join(root, 'scripts', `generate_${name}.py`)], { cwd: root, stdio: 'inherit', env: process.env })
  if (result.error || result.status !== 0) {
    console.error(`Could not generate ${name}: ${result.error?.message || `exit ${result.status}`}`)
    process.exit(1)
  }
}
