// 混合检索：字面 + 向量，各取前五，合并去重
// 用法：node search.mjs "查什么" [条数]
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { embed, cosine } from './embed.mjs'

const HOME = process.env.DSH_MEMORY_DIR || 'E:\\dsh\\home\\memory'
const CACHE = process.env.VEC_CACHE || './vec-cache.json'

const read = (f) => existsSync(f)
  ? readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  : []

function loadRows() {
  const out = []
  const rel = read(`${HOME}\\behavior\\relations.jsonl`)
  for (const r of rel) if (!r.voided) out.push({ hash: r.hash, kind: r.keyword?.startsWith('约') ? '约' : '关系', text: `${r.keyword} ＝ ${r.meaning}` })
  for (const n of read(`${HOME}\\behavior\\notes.jsonl`)) if (!n.voided) out.push({ hash: n.hash, kind: '笔记', text: n.text })
  for (const m of read(`${HOME}\\behavior\\memo.jsonl`)) if (!m.voided) out.push({ hash: m.hash, kind: '便签', text: m.text })
  for (const f of ['2026-11.jsonl', '2026-10.jsonl']) {
    for (const d of read(`${HOME}\\behavior\\diary\\${f}`)) {
      const t = `${d.user || ''} ${d.assistant || ''}`.trim()
      if (t) out.push({ hash: d.hash || `${f}:${d.ts}`, kind: '日记', text: t })
    }
  }
  return out.filter((r) => r.text && r.text.trim())
}

const bi = (s) => {
  const out = new Set()
  const z = String(s).replace(/\s+/g, '').toLowerCase()
  for (let i = 0; i < z.length - 1; i++) out.add(z.slice(i, i + 2))
  return out
}

const rows = loadRows()
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {}

async function ensureVectors(list) {
  const missing = list.filter((r) => !cache[r.hash])
  if (!missing.length) return
  const B = 32
  for (let i = 0; i < missing.length; i += B) {
    const chunk = missing.slice(i, i + B)
    const vs = await embed(chunk.map((r) => r.text.slice(0, 400)))
    chunk.forEach((r, k) => { cache[r.hash] = vs[k] })
  }
  writeFileSync(CACHE, JSON.stringify(cache))
  console.error(`（新编码 ${missing.length} 条）`)
}

const q = process.argv[2] || ''
const k = Number(process.argv[3] || 5)
if (!q) { console.error('用法: node search.mjs "查什么" [条数]'); process.exit(1) }

await ensureVectors(rows)
const qv = bi(q)
const [ev] = await embed([q])

const kw = rows.map((r) => {
  const v = bi(r.text)
  let inter = 0
  for (const x of qv) if (v.has(x)) inter++
  return { r, s: inter / (qv.size || 1), via: '字面' }
}).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, k)

const vec = rows
  .filter((r) => cache[r.hash])
  .map((r) => ({ r, s: cosine(ev, cache[r.hash]), via: '意思' }))
  .sort((a, b) => b.s - a.s).slice(0, k)

const seen = new Set()
const merged = []
for (const x of kw) { if (!seen.has(x.r.hash)) { seen.add(x.r.hash); merged.push(x) } }
for (const x of vec) {
  if (seen.has(x.r.hash)) { const f = merged.find((m) => m.r.hash === x.r.hash); if (f) f.via = '两边' ; continue }
  seen.add(x.r.hash); merged.push(x)
}

console.log(`查询：${q}　（条目 ${rows.length}）\n`)
for (const x of merged.slice(0, k * 2)) {
  console.log(`[${x.via}] ${x.s.toFixed(3)} ${x.r.kind}　${x.r.text.replace(/\s+/g, ' ').slice(0, 60)}`)
}
