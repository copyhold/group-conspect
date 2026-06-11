import { pipeline, env } from '@xenova/transformers'

const MODEL = process.env.EMBED_MODEL ?? 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'

// Cache models in ../data/models so they survive reinstalls
env.cacheDir = process.env.MODEL_CACHE ?? '../data/models'

let _pipe: Awaited<ReturnType<typeof pipeline>> | null = null

async function getPipe() {
  if (!_pipe) {
    console.log(`loading embedding model: ${MODEL}`)
    _pipe = await pipeline('feature-extraction', MODEL, { quantized: true })
    console.log('embedding model ready')
  }
  return _pipe
}

export async function embed(text: string): Promise<Float32Array> {
  const pipe = await getPipe()
  const output = await pipe(text, { pooling: 'mean', normalize: true })
  return output.data as Float32Array
}

export function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot  // both normalised
}
