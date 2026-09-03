import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { __test } from '../worker.js'
import { escapeHtml, isWikiUrl } from '../public/timeline.js'
import {
  houseNames,
  layoutTree,
  renderTreeNode,
  renderTreeSVG,
} from '../public/trees.js'

const data = JSON.parse(readFileSync(new URL('../dist/wiki/trees-index.json', import.meta.url), 'utf8'))
const houses = data.houses

test('trees index shape: 4 houses, 15 members joined from vault family files by title match', () => {
  assert.equal(houses.length, 4)
  assert.equal(data.files_scanned, 78)
  assert.deepEqual(houseNames(houses), ['Eisenheart', 'Kennensbach', 'Lulit', 'Mortvagn'])
  const members = houses.flatMap(house => house.members)
  assert.equal(members.length, 15)
  assert.ok(members.every(member => typeof member.name === 'string' && member.name.length > 0))
  assert.ok(members.every(member => Array.isArray(member.parents) && typeof member.path === 'string'))
  assert.ok(members.every(member => member.path === '' || isWikiUrl(member.path)))
  assert.ok(members.every(member => member.spouse === undefined || typeof member.spouse === 'string'))
  const withUrls = members.filter(member => member.path !== '')
  assert.equal(withUrls.length, 14)
  const names = members.map(member => member.name.toLowerCase())
  assert.ok(names.includes('emrys') && names.includes('lucien'), 'both protagonists present')
  for (const house of houses) {
    const houseNamesSorted = house.members.map(member => member.name.toLowerCase())
    assert.deepEqual(houseNamesSorted, [...houseNamesSorted].sort(), `${house.house} members ship pre-sorted by name`)
  }
  const eisenheart = houses.find(house => house.house === 'Eisenheart').members
  const emrys = eisenheart.find(member => member.name === 'Emrys')
  assert.deepEqual(emrys.parents, ['Marco Eisenheart', 'Annika Eisenheart'])
  const mortvagn = houses.find(house => house.house === 'Mortvagn').members
  const lucien = mortvagn.find(member => member.name === 'Lucien')
  assert.deepEqual(lucien.parents, ['Gallio Mortvagn', 'Herennia Mortvagn'])
  const gallio = mortvagn.find(member => member.name === 'Gallio Mortvagn')
  assert.equal(gallio.spouse, 'Herennia Mortvagn')
  // No invented people: every parent is a member of some house in the index.
  const known = new Set(members.map(member => member.name))
  assert.ok(members.every(member => member.parents.every(parent => known.has(parent))))
})

test('layout puts parents above children on a grid where no two nodes share x/y', () => {
  for (const house of houses) {
    const nodes = layoutTree(house.members)
    assert.equal(nodes.length, house.members.length)
    const positions = nodes.map(node => `${node.x}/${node.y}`)
    assert.equal(new Set(positions).size, positions.length, `${house.house}: overlapping nodes`)
    const byName = new Map(nodes.map(node => [node.name, node]))
    for (const node of nodes) {
      for (const parent of node.parents) {
        const source = byName.get(parent)
        if (source) assert.ok(source.y < node.y, `${node.name} sits above parent ${parent}`)
      }
    }
  }
  assert.deepEqual(layoutTree([]), [])
  // Hostile parents never become nodes; cycles cannot hang the layout.
  const hostile = layoutTree([{ name: 'A', path: '', parents: ['https://evil.example/x'] }])
  assert.equal(hostile.length, 1)
  const cyclic = layoutTree([
    { name: 'A', path: '', parents: ['B'] },
    { name: 'B', path: '', parents: ['A'] },
  ])
  assert.equal(cyclic.length, 2)
  assert.notEqual(`${cyclic[0].x}/${cyclic[0].y}`, `${cyclic[1].x}/${cyclic[1].y}`)
})

test('rendered nodes link only ^/wiki/ paths; hostile or empty paths render as text', () => {
  const svg = renderTreeSVG(layoutTree(houses.find(house => house.house === 'Mortvagn').members))
  assert.match(svg, /<svg[^>]*viewBox="0 0 \d+(\.\d+)? \d+(\.\d+)?"/)
  assert.match(svg, /href="\/wiki\//)
  assert.match(svg, /Lucien/)
  for (const member of [
    { name: 'Nowhere', path: '', parents: [] },
    { name: 'Evil', path: 'javascript:alert(1)', parents: [] },
    { name: 'Offsite', path: 'https://evil.example/wiki/x', parents: [] },
    { name: 'Sneaky', path: '/evil', parents: [] },
  ]) {
    const html = renderTreeNode({ ...member, x: 0, y: 0, generation: 0, spouse: '' })
    assert.doesNotMatch(html, /href="/, member.name)
    assert.match(html, new RegExp(escapeHtml(member.name)))
  }
  assert.equal(isWikiUrl('/wiki/World/History/Characters/Lucien/'), true)
  assert.deepEqual(houseNames([]), [])
})

test('trees gate: worker treats page and script as private', () => {
  assert.equal(__test.isPrivatePath('/trees'), true)
  assert.equal(__test.isPrivatePath('/trees/'), true)
  assert.equal(__test.isPrivatePath('/trees.html'), true)
  assert.equal(__test.isPrivatePath('/trees.js'), true)
  assert.equal(__test.isPrivatePath('/wiki/trees-index.json'), true)
})

test('trees shell fetches the gated index, mounts the house select, stays noindex', () => {
  const html = readFileSync(new URL('../public/trees.html', import.meta.url), 'utf8')
  assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive" \/>/)
  assert.match(html, /id="houseSelect"/)
  assert.match(html, /id="treesCanvas"/)
  assert.match(html, /id="treesStatus"/)
  assert.match(html, /src="\/trees\.js"/)
  assert.match(html, /src="\/archive-compass\.js"/)
  const script = readFileSync(new URL('../public/trees.js', import.meta.url), 'utf8')
  assert.match(script, /from '\.\/timeline\.js'/)
  assert.match(script, /isWikiUrl/)
  assert.match(script, /escapeHtml/)
  assert.match(script, /\/wiki\/trees-index\.json/)
  const workerSource = readFileSync(new URL('../worker.js', import.meta.url), 'utf8')
  assert.match(workerSource, /\['\/trees', '\/trees\.html'\]/)
  assert.match(workerSource, /'\/trees\.js'/)
  const compass = readFileSync(new URL('../public/archive-compass.js', import.meta.url), 'utf8')
  assert.match(compass, /url: '\/trees'/)
})
