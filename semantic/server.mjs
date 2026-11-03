// 语义检索服务：单独进程，宿主只通过 HTTP 问它
// 崩也只崩自己，不会带走 DSH
// 用途： GET /search?q=查什么&k=3   → {ok:true, items:[{hash,kind,text,score,via}]}
//        GET /health               → {ok:true, ready:bool, rows:n}
import http from 'node:http'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'

const PORT = Number(process.env.SEM_PORT || 3075)
const HOME = process.env.DSH_MEMORY_DIR || 'E:\\dsh\\home\\memory'
// 每间屋子一份缓存：用记忆目录的短哈希区分，别互相污染
const MEM_TAG = (await import('node:crypto')).createHash('sha1').update(HOME).digest('hex').slice(0, 8)
const CACHE = (process.env.VEC_CACHE_DIR || '.') + '\\vec-cache-' + MEM_TAG + '.json'

const readJsonl = (f) => existsSync(f)
  ? readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean)
      .map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  : []

let rowsCache = null
let cacheOnDisk = null
let embedMod = null
let ready = false

function rows() {
  if (rowsCache) return rowsCache
  const out = []
  for (const r of readJsonl(`${HOME}\\behavior\\relations.jsonl`)) {
    if (!r || r.voided) continue
    out.push({ hash: r.hash, kind: r.keyword?.startsWith('约') ? '约' : '关系', text: `${r.keyword} ＝ ${r.meaning}` })
  }
  for (const x of readJsonl(`${HOME}\\behavior\\notes.jsonl`)) if (x && !x.voided) out.push({ hash: x.hash, kind: '笔记', text: x.text })
  for (const x of readJsonl(`${HOME}\\behavior\\memo.jsonl`)) if (x && !x.voided) out.push({ hash: x.hash, kind: '便签', text: x.text })
  for (const f of ['2026-11.jsonl', '2026-10.jsonl']) {
    for (const d of readJsonl(`${HOME}\\behavior\\diary\\${f}`)) {
      const t = `${d.user || ''} ${d.assistant || ''}`.trim()
      if (t) out.push({ hash: d.hash || `${f}:${d.ts}`, kind: '日记', text: t })
    }
  }
  rowsCache = out.filter((r) => r.text && r.text.trim())
  return rowsCache
}

function vectors() {
  if (!cacheOnDisk) cacheOnDisk = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {}
  return cacheOnDisk
}

const bi = (s) => {
  const out = new Set()
  const z = String(s).replace(/\s+/g, '').toLowerCase()
  for (let i = 0; i < z.length - 1; i++) out.add(z.slice(i, i + 2))
  return out
}

async function loadEmbed() {
  if (!embedMod) embedMod = await import('file:///E:/dsh/tools/embed/embed.mjs')
  return embedMod
}

async function ensure(list) {
  const cache = vectors()
  const missing = list.filter((r) => !cache[r.hash]).slice(0, 400)
  if (!missing.length) { ready = true; return }
  const mod = await loadEmbed()
  for (let i = 0; i < missing.length; i += 16) {
    const chunk = missing.slice(i, i + 16)
    const vs = await mod.embed(chunk.map((r) => r.text.slice(0, 400)))
    chunk.forEach((r, k) => { cache[r.hash] = vs[k] })
  }
  writeFileSync(CACHE, JSON.stringify(cache))
  ready = true
}

async function search(query, k) {
  const list = rows()
  await ensure(list)
  const cache = vectors()
  const mod = await loadEmbed()
  const [ev] = await mod.embed([query])

  const qv = bi(query)
  const kw = []
  for (const r of list) {
    const v = bi(r.text)
    let inter = 0
    for (const x of qv) if (v.has(x)) inter++
    const score = inter / (qv.size || 1)
    if (score > 0) kw.push({ hash: r.hash, kind: r.kind, text: r.text.slice(0, 160), score, via: '字面' })
  }
  kw.sort((a, b) => b.score - a.score)

  const vec = []
  for (const r of list) {
    const v = cache[r.hash]
    if (!v) continue
    vec.push({ hash: r.hash, kind: r.kind, text: r.text.slice(0, 160), score: mod.cosine(ev, v), via: '意思' })
  }
  vec.sort((a, b) => b.score - a.score)

  const seen = new Map()
  const push = (x) => {
    const old = seen.get(x.hash)
    if (old) { old.via = '两边'; old.score = Math.max(old.score, x.score); return }
    seen.set(x.hash, { ...x })
  }
  kw.slice(0, k).forEach(push)
  vec.slice(0, k).forEach(push)

  return [...seen.values()]
    .filter((x) => x.score >= 0.55 || x.via !== '意思')
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  res.setHeader('content-type', 'application/json; charset=utf-8')
  try {
    if (url.pathname === '/health') {
      res.end(JSON.stringify({ ok: true, ready, rows: rows().length }))
      return
    }
    if (url.pathname === '/search') {
      const q = String(url.searchParams.get('q') || '').trim()
      const k = Math.max(1, Math.min(10, Number(url.searchParams.get('k') || 3)))
      if (q.length < 2) { res.end(JSON.stringify({ ok: true, items: [] })); return }
      const items = await search(q, k)
      res.end(JSON.stringify({ ok: true, items }))
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ ok: false, error: 'no such route' }))
  } catch (err) {
    res.statusCode = 500
    res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }))
  }
})

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') { console.log('端口 ' + PORT + ' 已被占用，这个实例退出'); process.exit(0) }
  console.log('服务出错：' + (err?.message || err)); process.exit(1)
})
server.listen(PORT, '127.0.0.1', () => {
  console.log(`语义检索服务 http://127.0.0.1:${PORT}  条目 ${rows().length}`)
})
