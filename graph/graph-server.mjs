import { createServer } from 'node:http'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, normalize } from 'node:path'

// 没设环境变量就直接说清楚，别跑到一半才炸
function require_dir() {
  console.error('缺少环境变量 MEM_GRAPH_DIR（指向记忆图输出目录）')
  process.exit(1)
}

const ROOT = process.env.MEM_GRAPH_DIR || require_dir()
const PORT = 3072
const TYPES = { '.txt': 'text/plain; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8' }

createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0])
  if (url === '/recall' || url.startsWith('/recall?')) {
    const rf = normalize(join(ROOT, 'recall-log.jsonl'))
    let rows = []
    try {
      rows = readFileSync(rf, 'utf8').split(/\r?\n/).filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    } catch {}
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(rows.slice(-200)))
    return
  }
  if (url.startsWith('/find')) {
    const q4 = (new URL('http://x' + (req.url || '/')).searchParams.get('q') || '').trim()
    const bases = (process.env.MEM_SEARCH_DIRS || '').split(';').filter(Boolean)
    const hits = []
    const probe = q4.replace(/^约·/, '').slice(0, 8)
    if (probe.length >= 2) {
      for (const b of bases) {
        let list = []
        try { list = readdirSync(b, { withFileTypes: true }) } catch { continue }
        for (const d of list) {
          if (!d.isFile()) continue
          const nm = d.name
          if (!/\.(txt|md)$/i.test(nm)) continue
          const core = nm.replace(/\.[^.]+$/, '')
          if (core.includes(probe) || probe.includes(core.slice(0, 6)) || core.includes(probe.slice(0, 4)) || probe.includes(core.slice(0, 4))) {
            hits.push(nm)
          }
        }
        if (hits.length) break
      }
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(hits.slice(0, 5)))
    return
  }
  if (url.startsWith('/src')) {
    const q3 = new URL('http://x' + (req.url || '/')).searchParams.get('p') || ''
    const base = (process.env.MEM_SEARCH_DIRS || '').split(';')[0] || ROOT
    const fp = normalize(join(base, q3))
    if (!fp.startsWith(base) || !existsSync(fp)) { res.writeHead(404); res.end('no src'); return }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    res.end(readFileSync(fp))
    return
  }
  if (url.startsWith('/md')) {
    const q2 = new URL('http://x' + (req.url || '/')).searchParams.get('p') || ''
    const mp = normalize(join(ROOT, q2))
    if (!mp.startsWith(ROOT) || !existsSync(mp)) { res.writeHead(404); res.end('no md'); return }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    res.end(readFileSync(mp))
    return
  }
  const rel = url === '/' ? '/graph.html' : url
  const p = normalize(join(ROOT, rel))
  if (!p.startsWith(ROOT)) { res.writeHead(403); res.end('no'); return }
  if (!existsSync(p)) { res.writeHead(404); res.end('not found: ' + rel); return }
  const ext = p.slice(p.lastIndexOf('.'))
  res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': 'no-store' })
  res.end(readFileSync(p))
}).listen(PORT, '127.0.0.1', () => console.log('graph on http://127.0.0.1:' + PORT))
