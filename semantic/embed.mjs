// 本地向量检索：把记忆条目编码成向量，按余弦相似度找
// 用 @xenova/transformers 跑 onnx 模型，全程离线，不发任何请求
import { env, pipeline } from '@xenova/transformers'

env.allowRemoteModels = true      // 只有第一次下载模型时联网，之后走本地缓存
env.remoteHost = process.env.HF_ENDPOINT || 'https://hf-mirror.com'   // 国内镜像，别直连 huggingface
env.cacheDir = process.env.EMBED_CACHE || './models'

const MODEL = 'Xenova/bge-small-zh-v1.5'

let extractorPromise = null
export function getExtractor() {
  if (!extractorPromise) extractorPromise = pipeline('feature-extraction', MODEL, { quantized: true })
  return extractorPromise
}

export async function embed(texts) {
  const ex = await getExtractor()
  const out = []
  for (const t of texts) {
    const r = await ex(String(t).slice(0, 512), { pooling: 'mean', normalize: true })
    out.push(Array.from(r.data))
  }
  return out
}

export function cosine(a, b) {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}
