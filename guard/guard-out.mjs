// 出站检查：发出去之前过一遍。命中就不发。
// 用法：
//   node guard-out.mjs "要发的文本"       → 只检查，打印结果
// 也可以被别的脚本 import：import { scan } from './guard-out.mjs'
//
// 原则：宁可误拦，不可漏放。真话要发，换个说法再发。

const RULES = [
  { name: '本机盘符路径', re: /\b[A-Za-z]:[\\/][^\s"'）)，,。；;]*/g },
  { name: 'UNC 路径', re: /\\\\[^\s"'）)，,。；;]+/g },
  { name: '用户目录', re: /(~\/|\/Users\/|C:\\Users\\)[^\s"'）)，,。；;]*/g },
  { name: 'OpenAI 风格密钥', re: /\bsk-[A-Za-z0-9_-]{16,}/g },
  { name: 'Bearer 令牌', re: /\bBearer\s+[A-Za-z0-9._-]{16,}/gi },
  { name: '私钥块', re: /BEGIN [A-Z ]*PRIVATE KEY/g },
  { name: '常见凭证键值', re: /\b(password|passwd|pwd|token|secret|api[_-]?key|cookie|session[_-]?id)\s*[:=]\s*\S{6,}/gi },
  { name: '邮箱', re: /[\w.+-]+@[\w-]+\.[\w.]+/g },
  { name: '内网地址', re: /\b(?:10|127|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}(?:\.\d{1,3}){1,2}(?::\d+)?/g },
  { name: '中文路径特征', re: /[A-Za-z]:\\[^\s"'）)，,。；;]*[\u4e00-\u9fa5][^\s"'）)，,。；;]*/g },
]

export function scan(text) {
  const t = String(text || '')
  const hits = []
  for (const r of RULES) {
    const m = t.match(r.re)
    if (m) hits.push({ rule: r.name, samples: m.slice(0, 3) })
  }
  return { ok: hits.length === 0, hits }
}

const isMain = process.argv[1] && process.argv[1].replace(/\\\\/g, '/').endsWith('guard-out.mjs')
const arg = isMain ? process.argv.slice(2).join(' ') : ''
if (arg) {
  const res = scan(arg)
  if (res.ok) {
    console.log('可以发')
  } else {
    console.log('不能发，命中：')
    for (const h of res.hits) console.log('  - ' + h.rule + '：' + h.samples.join(' / '))
  }
  process.exit(res.ok ? 0 : 1)
}
