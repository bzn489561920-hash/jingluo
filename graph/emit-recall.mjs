// 最小写入器：不依赖任何记忆插件，从 jsonl 记忆库算出「这一轮大概会取到哪几条」，写进 recall-log.jsonl
//
// 用法：
//   node emit-recall.mjs "登录那天说的话"
//
// 环境变量：
//   DSH_MEMORY_DIR  记忆库目录（默认 ./memory）
//   MEM_GRAPH_DIR   记忆图目录（recall-log.jsonl 写这儿）
//
// 它做的是「复刻规则」，不是「读插件」。所以它算出来的 hits 可能和你真实注入的略有出入。
// 想要完全一致，就在你自己的记忆插件里，在拼注入文本的地方照着这个格式写一行。

import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'

const MEM = process.env.DSH_MEMORY_DIR || './memory'
const GRAPH = process.env.MEM_GRAPH_DIR || './graph'
const LOG = `${GRAPH}\\recall-log.jsonl`

const readJsonl = (f) => (existsSync(f)
  ? readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean)
      .map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  : [])

const rows = []
for (const r of readJsonl(`${MEM}\\behavior\\relations.jsonl`)) {
  if (!r || r.voided) continue
  rows.push({ hash: r.hash, kind: 'relation', text: `${r.keyword} ＝ ${r.meaning}`, ts: r.ts || '' })
}
for (const n of readJsonl(`${MEM}\\behavior\\notes.jsonl`)) {
  if (!n || n.voided) continue
  rows.push({ hash: n.hash, kind: 'note', text: n.text || '', ts: n.ts || '' })
}
for (const m of readJsonl(`${MEM}\\behavior\\memo.jsonl`)) {
  if (!m || m.voided) continue
  rows.push({ hash: m.hash, kind: 'memo', text: m.text || '', ts: m.ts || '' })
}

const q = process.argv.slice(2).join(' ')
if (!q) { console.error('用法: node emit-recall.mjs "这句话"'); process.exit(1) }

// 字面：字符二元组重合
const bigrams = (s) => {
  const out = new Set()
  const z = String(s).replace(/\s+/g, '').toLowerCase()
  for (let i = 0; i < z.length - 1; i += 1) out.add(z.slice(i, i + 2))
  return out
}
const qb = bigrams(q)
const scored = rows.map((r) => {
  const rb = bigrams(r.text)
  let hit = 0
  for (const x of qb) if (rb.has(x)) hit += 1
  return { ...r, score: hit / (qb.size || 1) }
}).filter((x) => x.score > 0).sort((a, b) => b.score - a.score)

const top = scored.slice(0, 12)
const hits = top.map((x) => String(x.hash))

const why = {}
for (const x of top) why[String(x.hash)] = `关系：字面重合 ${(x.score * 100).toFixed(0)}%，排进了预算`

// 沉在底下：最久没出现的一条
const oldest = rows.filter((r) => !hits.includes(String(r.hash))).sort((a, b) => String(a.ts).localeCompare(String(b.ts)))[0]
if (oldest) {
  hits.push(String(oldest.hash))
  why[String(oldest.hash)] = '沉在底下：最久没被翻过的一条，主动推上来'
}

const text = top.map((x) => `- ${x.text.slice(0, 40)}`).join('\n')
const round = {
  ts: new Date().toISOString(),
  session: 'manual',
  query: q,
  summary: text.length,
  hits,
  why,
  text,
}

if (!existsSync(GRAPH)) mkdirSync(GRAPH, { recursive: true })
appendFileSync(LOG, JSON.stringify(round) + '\n')
console.log(`写了 ${hits.length} 条 → ${LOG}`)
console.log(`查询：${q}`)
for (const x of top.slice(0, 5)) console.log(`  ${x.text.slice(0, 34)}  (${(x.score * 100).toFixed(0)}%)`)
