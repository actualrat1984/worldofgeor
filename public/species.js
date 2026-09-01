const SPECIES = [
  ['Elves','Humanoid','Ancient peoples carrying a civilization diminished by war and memory.','/wiki/World/Species/Elves/Elves/'],
  ['Dwarves','Humanoid','Mountain dwellers whose forges once defined an age of impossible craft.','/wiki/World/Species/Dwarves/Dwarves/'],
  ['Humans','Humanoid','Ge’or’s dominant population, divided across empires, nations, and lineages.','/wiki/World/Species/Humans/Humans/'],
  ['Demons','Arcane','Civilized warrior descendants shaped by inheritance rather than simple evil.','/wiki/World/Species/Demons/Demons/'],
  ['Orcs','Humanoid','A varied and civilized people too often reduced to an outsider’s myth.','/wiki/World/Species/Orcs/'],
  ['Snake People','Beastkin','Serpentine civilizations governed through enduring queen-monarchies.','/wiki/World/Species/Snake People/'],
  ['Catmen','Beastkin','Feline humanoids found across several distinct cultures and castes.','/wiki/World/Species/Catmen/'],
  ['Malgardians','Otherworldly','Purple-haired humanoid off-worlders with their own fractured inheritances.','/wiki/World/Species/Malgardians/Malgardians/'],
  ['Beast Races','Beastkin','A broad family of peoples joining human and animal forms.','/wiki/World/Species/Beast Races/Beast Races/'],
  ['Kobolds','Beastkin','Reptilian trap-crafters whose ingenuity rewards careful travelers.','/wiki/World/Species/Kobolds/Kobolds/'],
  ['Goblins','Humanoid','Tribal societies with a fearsome reputation and violent traditions.','/wiki/World/Species/Goblins/Goblins/'],
  ['Harpies','Beastkin','Winged peoples created as biological weapons during the Last Great War.','/wiki/World/Species/Harpies/Harpies/'],
  ['Gnolls','Beastkin','Hyena-like pack hunters organized by kinship, territory, and strength.','/wiki/World/Species/Gnolls/Gnolls/'],
  ['Dragons','Arcane','Near-extinct powers whose clans once divided the world between them.','/wiki/World/Species/Dragons/Dragons/'],
  ['Trolls','Humanoid','Massive, regenerative beings whose simplicity hides extraordinary endurance.','/wiki/World/Species/Trolls/Trolls/'],
  ['Wargs','Beastkin','Great wolf-like predators woven into the histories of hunters and warbands.','/wiki/World/Species/Wargs/Wargs/'],
  ['Homunculi','Constructed','Living Hybrian bio-constructs made for purposes not always their own.','/wiki/World/Species/Homunculi/Homunculi/'],
  ['Hybrians','Otherworldly','Parasitic entities and their Shadows, moving through borrowed lives.','/wiki/World/Species/Hybrians/Hybrians/'],
  ['Flames','Elemental','Gas-based, mineral-eating life unlike the flesh-born peoples around them.','/wiki/World/Species/Flames/'],
  ['Giants','Humanoid','Three-metre humanoids whose scale shapes every settlement they inhabit.','/wiki/World/Species/Giants/'],
  ['Diablos','Beastkin','Winged nocturnal peoples adapted to a world most encounter only by day.','/wiki/World/Species/Diablos/'],
  ['Kutra (Owlkin)','Beastkin','Semi-aquatic owl-like humanoids with lives tied to water and sky.','/wiki/World/Species/Kutra (Owlkin)/'],
  ['Yaoma (Merfolk)','Aquatic','Merfolk whose settlements and traditions belong beneath the surface.','/wiki/World/Species/Yaoma (Merfolk)/'],
  ['Sandsmen','Humanoid','Desert-adapted humanoids formed by scarcity, distance, and heat.','/wiki/World/Species/Sandsmen/'],
  ['Treemen','Plantborn','Tree-dwelling humanoids whose homes and bodies share a living world.','/wiki/World/Species/Treemen/'],
  ['Slimes','Arcane','Mostly irrational beings with a rare and consequential intelligent variant.','/wiki/World/Species/Slimes/'],
  ['Angels','Arcane','A celestial people recorded among Ge’or’s stranger sentient lineages.','/wiki/World/Species/Angels/'],
  ['Coldspeople','Humanoid','A people adapted to cold lands where survival becomes culture.','/wiki/World/Species/Coldspeople/'],
  ['Half-Elves','Humanoid','Lives suspended between human history and the long memory of elves.','/wiki/World/Species/Half-Elves/'],
  ['Halflings','Humanoid','A small-statured people with a distinct place in Ge’or’s migrations.','/wiki/World/Species/Halflings/'],
  ['Machines','Constructed','Constructed intelligences whose existence complicates the meaning of life.','/wiki/World/Species/Machines/Machines/'],
  ['Madarons','Otherworldly','A distinct people whose folio sits at the edge of familiar taxonomy.','/wiki/World/Species/Madarons/'],
  ['Ogres','Humanoid','Large humanoids whose presence has shaped borderland stories and fear.','/wiki/World/Species/Ogres/'],
  ['Zombies','Constructed','The animate dead catalogued as a people because the archive has learned caution.','/wiki/World/Species/Zombies/'],
].map(([name,family,description,url],index)=>({name,family,description,url,index}))

const PALETTE = { Humanoid:'#d9b77a', Beastkin:'#bc9d70', Arcane:'#b9a2cf', Otherworldly:'#86b6ad', Constructed:'#9aafa8', Elemental:'#d38c63', Aquatic:'#73aeba', Plantborn:'#8dab77' }
const SIGILS = { Humanoid:'◇', Beastkin:'◆', Arcane:'✦', Otherworldly:'◈', Constructed:'⌬', Elemental:'△', Aquatic:'≈', Plantborn:'♧' }
const search = document.querySelector('#speciesSearch')
const filterBar = document.querySelector('#filterBar')
const sort = document.querySelector('#speciesSort')
const grid = document.querySelector('#speciesGrid')
const count = document.querySelector('#resultsCount')
const empty = document.querySelector('#emptyState')
let activeFamily = 'All'

const families = ['All', ...new Set(SPECIES.map(item => item.family))]
filterBar.innerHTML = families.map(family => `<button type="button" class="filter-button${family === 'All' ? ' is-active' : ''}" data-family="${family}" aria-pressed="${family === 'All'}">${family}</button>`).join('')

function card(item, visibleIndex) {
  const number = String(item.index + 1).padStart(2, '0')
  return `<a class="species-card" href="${encodeURI(item.url)}" style="--accent:${PALETTE[item.family]}" aria-label="Open ${item.name} in the private wiki"><div class="card-top"><span class="folio-number">FOLIO ${number}</span><span class="species-sigil" aria-hidden="true"><span>${SIGILS[item.family]}</span></span></div><div class="card-body"><span class="family">${item.family}</span><h2>${item.name}</h2><p>${item.description}</p></div><div class="card-foot"><span>ARCHIVE ENTRY · ${String(visibleIndex + 1).padStart(2, '0')}</span><b aria-hidden="true">→</b></div></a>`
}

function render() {
  const query = search.value.trim().toLocaleLowerCase()
  let items = SPECIES.filter(item => (activeFamily === 'All' || item.family === activeFamily) && (!query || `${item.name} ${item.family} ${item.description}`.toLocaleLowerCase().includes(query)))
  if (sort.value === 'az') items.sort((a,b) => a.name.localeCompare(b.name))
  if (sort.value === 'family') items.sort((a,b) => a.family.localeCompare(b.family) || a.name.localeCompare(b.name))
  grid.innerHTML = items.map(card).join('')
  grid.hidden = !items.length; empty.hidden = Boolean(items.length); grid.setAttribute('aria-busy', 'false')
  count.textContent = `${items.length} ${items.length === 1 ? 'folio' : 'folios'} in view`
}

filterBar.addEventListener('click', event => {
  const button = event.target.closest('button[data-family]'); if (!button) return
  activeFamily = button.dataset.family
  filterBar.querySelectorAll('button').forEach(item => { const on = item === button; item.classList.toggle('is-active', on); item.setAttribute('aria-pressed', String(on)) })
  render()
})
search.addEventListener('input', render); sort.addEventListener('change', render)
document.querySelector('#clearFilters').addEventListener('click', () => { search.value = ''; activeFamily = 'All'; sort.value = 'archive'; filterBar.querySelector('[data-family="All"]').click(); search.focus() })
document.addEventListener('keydown', event => {
  if (event.key === '/' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) { event.preventDefault(); search.focus() }
  if (event.key === 'Escape' && document.activeElement === search && search.value) { search.value = ''; render() }
})

fetch('/api/me', { credentials:'same-origin' }).then(response => { if (!response.ok) location.href = `/?next=${encodeURIComponent('/species')}` }).catch(() => { location.href = `/?next=${encodeURIComponent('/species')}` })
render()
