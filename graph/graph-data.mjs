// 记忆图数据：节点 + 语义边（标题切片共现），没有语义边的退回时间线
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'

// 没设环境变量就直接说清楚，别跑到一半才炸
function require_dir() {
  console.error('缺少环境变量 MEM_GRAPH_DIR（指向记忆图输出目录）')
  process.exit(1)
}

const ROOT = process.env.MEM_GRAPH_DIR || require_dir()
const OUT = ROOT + '\\graph-data.js'

const nodes = []

function walk(dir, depth = 0) {
  if (depth > 2) return
  let items = []
  try { items = readdirSync(dir) } catch { return }
  for (const name of items) {
    const p = join(dir, name)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) { walk(p, depth + 1); continue }
    if (!name.endsWith('.md') || name === 'index.md') continue

    let raw = ''
    try { raw = readFileSync(p, 'utf8') } catch { continue }
    const fm = raw.match(/^---\n([\s\S]*?)\n---/)
    const meta = {}
    if (fm) for (const line of fm[1].split('\n')) {
      const m = line.match(/^(\w+):\s*(.*)$/)
      if (m) meta[m[1]] = m[2].trim()
    }
    const body = raw.replace(/^---\n[\s\S]*?\n---/, '').trim()
    const titleLine = (body.split('\n').find(l => l.startsWith('# ')) || '').replace(/^#\s*/, '')
    const flat = body.replace(/^#.*$/gm, '').replace(/\s+/g, ' ').trim()
    if (meta.voided === 'true') continue
    nodes.push({
      id: meta.hash || basename(name, '.md'),
      title: (titleLine || basename(name, '.md')).slice(0, 80),
      layer: meta.layer || (p.includes('日记') ? 'diary' : 'note'),
      ts: meta.ts || '',
      use: Number(meta.useCount || 0),
      voided: meta.voided === 'true',
      snippet: flat.slice(0, 180),
      folder: basename(dir),
      role: null,
      path: p.slice(ROOT.length + 1).replace(/\\\\/g, '/')
    })
  }
}
walk(ROOT)
for (const n of nodes) n.role = roleOf(n)
// 两层：约/承诺 = full（永不衰减、只在查的时候出现）；其余 = decay（会忘、会模糊）
for (const n of nodes) n.tier = (n.role === 'covenant' || n.role === 'name') ? 'full' : 'decay'

// —— 角色：约 / 名字 / 日记 / 普通 ——
function roleOf(n) {
  const t = n.title || ''
  if (n.layer === 'diary') return 'river'
  if (t.startsWith('约·') || /^约/.test(t)) return 'covenant'
  if (/名字|小汐|小夕|称呼/.test(t)) return 'name'
  if (n.layer === 'relation' && /^(我几天|思考用中文)/.test(t)) return 'covenant'
  return 'core'
}
// —— 语义边：标题的三字切片 + 正文里出现就加权 ——
const STOP = ['他说', '她说', '我说', '他说了', '他说我', '这个', '那个', '什么', '怎么', '还是', '就是', '不是', '没有', '可以', '一个', '自己', '我们', '你们', '他们', '现在', '然后', '因为', '所以', '但是', '已经', '时候', '这样', '那样', '知道', '觉得', '感觉', '这句', '那句']
const clean2 = s => STOP.reduce((t, w) => t.split(w).join(''), clean(s))
const clean = s => (s || '').replace(/[\s\p{P}\p{S}]/gu, '')
const shingles = s => {
  const t = clean(s)
  const out = new Set()
  for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3))
  return out
}
const sh = new Map(nodes.map(n => [n.id, shingles(n.title)]))
const text = new Map(nodes.map(n => [n.id, clean2(n.title + " " + n.snippet)]))

const sem = []
for (let i = 0; i < nodes.length; i++) {
  for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j]
    let hit = 0
    for (const s of sh.get(a.id)) {
      if (sh.get(b.id).has(s)) hit += 2
      else if (text.get(b.id).includes(s)) hit += 1
    }
    for (const s of sh.get(b.id)) {
      if (sh.get(a.id).has(s)) continue
      if (text.get(a.id).includes(s)) hit += 1
    }
    if (hit >= 5) sem.push([a.id, b.id, hit])
  }
}
sem.sort((x, y) => y[2] - x[2])
const semKeep = sem.slice(0, 150)

// —— 分簇：按记忆类型（关系/档案/笔记/便签）分成几团 ——
const LAYER_ORDER = ['relation', 'user', 'note', 'memo', 'diary']
for (const n of nodes) {
  const i = LAYER_ORDER.indexOf(n.layer)
  n.group = i < 0 ? LAYER_ORDER.length : i
}
const groups = LAYER_ORDER.length + 1
// —— 时间线兜底：没语义边的节点按天连 ——
const linked = new Set(semKeep.flatMap(([a, b]) => [a, b]))
const byDay = new Map()
for (const n of nodes) {
  if (linked.has(n.id)) continue
  const day = (n.ts || '').slice(0, 10)
  if (!day) continue
  if (!byDay.has(day)) byDay.set(day, [])
  byDay.get(day).push(n.id)
}
const timeEdges = []
for (const [, ids] of byDay) {
  ids.sort()
  for (let i = 1; i < ids.length; i++) { if (!linked.has(ids[i - 1]) || !linked.has(ids[i])) timeEdges.push([ids[i - 1], ids[i]]) }
}

const edges = semKeep.map(([a, b, w]) => [a, b, w, 'sem'])
  .concat(timeEdges.map(([a, b]) => [a, b, 1, 'time']))

writeFileSync(OUT, 'window.GRAPH = ' + JSON.stringify({ nodes, edges }) + ';\n', 'utf8')
console.log('nodes', nodes.length, '语义边', semKeep.length, '时间边', timeEdges.length, '簇', groups)
