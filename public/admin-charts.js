// Admin charts (Wave G5) — horizontal SVG bars over the live /api/admin/stats
// numbers. Pure helpers are exported so node --test can verify scaling and
// label escaping without a browser. Zero dependencies, no fetch here: the
// admin page passes its already-fetched stats object in, and renderAdminCharts
// paints the inline SVG into the given container.
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
}

export function scaleMax(values) {
  if (!Array.isArray(values) || values.length === 0) return 0
  let max = 0
  for (const raw of values) {
    const n = Number(raw)
    if (Number.isFinite(n) && n > max) max = n
  }
  return max
}

export function chartDataFromStats(stats) {
  const source = stats && typeof stats === 'object' ? stats : {}
  const countOf = value => {
    const n = Number(value)
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  return [
    { label: 'Members', value: countOf(source.users) },
    { label: 'Open invites', value: countOf(source.openInvites) },
    { label: 'Pending requests', value: countOf(source.pendingRequests) },
    { label: 'Archive events', value: countOf(source.additions) },
  ]
}

function barWidthPct(value, max) {
  if (!(max > 0)) return 0
  const pct = (Number(value) / max) * 100
  return Math.round(pct * 10) / 10
}

export function barChart(items) {
  const rows = Array.isArray(items) ? items : []
  const max = scaleMax(rows.map(row => row && row.value))
  const labelH = 14
  const barH = 8
  const pad = 4
  const step = labelH + barH + pad
  const height = rows.length > 0 ? rows.length * step + pad : 24
  const bars = rows.map((row, index) => {
    const label = escapeHtml(row && row.label != null ? row.label : '')
    const raw = Number(row && row.value)
    const value = Number.isFinite(raw) && raw > 0 ? raw : 0
    const pct = barWidthPct(value, max)
    const shown = escapeHtml(Number.isInteger(value) ? value.toLocaleString('en-US') : String(value))
    const y = pad + index * step
    return `<g><text x="0" y="${y + 11}" font-size="11" fill="currentColor" opacity="0.75">${label} — ${shown}</text><rect x="0" y="${y + labelH}" width="${pct}%" height="${barH}" rx="4" fill="currentColor" opacity="0.85"><title>${label}: ${shown}</title></rect></g>`
  }).join('')
  const empty = rows.length === 0 ? '<text x="0" y="15" font-size="11" fill="currentColor" opacity="0.6">No data</text>' : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 ${height}" width="100%" height="${height}" role="img" aria-label="Admin stats chart">${bars}${empty}</svg>`
}

export function renderAdminCharts(container, stats) {
  const svg = barChart(chartDataFromStats(stats))
  if (container && typeof container === 'object' && 'innerHTML' in container) container.innerHTML = svg
  return svg
}
