// Sarvam AI (docs.sarvam.ai): STT POST /speech-to-text (multipart, ≤30 s audio, language auto-detected),
// translate POST /translate, TTS POST /text-to-speech (JSON → base64 WAV), and the chat model that turns one
// spoken sentence into form fields. Server-side only; the browser falls back to its own speech APIs without it.
import { CATEGORIES, UNITS, VOICE_LANGS, type VoiceLang } from './types'

const BASE = 'https://api.sarvam.ai'
export const sarvamConfigured = () => Boolean(process.env.SARVAM_API_KEY)
const headers = () => ({ 'api-subscription-key': process.env.SARVAM_API_KEY!, 'Content-Type': 'application/json' })
const isVoiceLang = (l: unknown): l is VoiceLang => typeof l === 'string' && l in VOICE_LANGS

async function post(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`Sarvam ${path} ${res.status}`)
  return res.json()
}

export async function transcribe(audio: Blob): Promise<{ transcript: string; language: VoiceLang | null }> {
  const form = new FormData()
  form.append('file', audio, 'speech.webm')
  form.append('model', 'saaras:v4')
  form.append('language_code', 'unknown')
  const res = await fetch(`${BASE}/speech-to-text`, { method: 'POST', headers: { 'api-subscription-key': process.env.SARVAM_API_KEY! }, body: form, signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`Sarvam STT ${res.status}`)
  const j = await res.json()
  return { transcript: typeof j?.transcript === 'string' ? j.transcript.trim() : '', language: isVoiceLang(j?.language_code) ? j.language_code : null }
}

export type Understood = Partial<Record<'product' | 'brand_or_variant' | 'unit' | 'category' | 'city' | 'area', string> & { quantity: number }>

const PROMPT = `Extract a shopping request. Reply with ONLY a JSON object with keys: product (string: the item with its brand, in Latin script as commonly written, e.g. "Amul Butter", "Dolo 650"), brand_or_variant (string|null: only a size, pack or variant such as "500g" or "65W"), quantity (number|null), unit (one of ${UNITS.join(', ')}, or null), category (one of ${CATEGORIES.join(', ')}, or null), city (string|null, in English), area (string|null, in English). Never guess: use null when not said.`

// Untrusted model output → only known keys, known enum values and short strings survive. The user still
// reviews every field, and the server validates the search again.
export function cleanUnderstood(raw: unknown): Understood {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const str = (k: string, max: number) => (typeof o[k] === 'string' && o[k].trim() ? (o[k] as string).trim().slice(0, max) : undefined)
  const q = typeof o.quantity === 'number' && o.quantity > 0 && o.quantity <= 1000 ? Math.round(o.quantity * 100) / 100 : undefined
  const out: Understood = {
    product: str('product', 120),
    brand_or_variant: str('brand_or_variant', 80),
    quantity: q,
    unit: (UNITS as readonly unknown[]).includes(o.unit) ? (o.unit as string) : undefined,
    category: (CATEGORIES as readonly unknown[]).includes(o.category) ? (o.category as string) : undefined,
    city: str('city', 60),
    area: str('area', 80),
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as Understood
}

export async function understand(text: string): Promise<Understood> {
  const j = await post('/v1/chat/completions', {
    model: 'sarvam-105b-conversations',
    temperature: 0,
    max_tokens: 300,
    messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: text.slice(0, 500) }],
  })
  const content = String(j?.choices?.[0]?.message?.content ?? '')
  const json = content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1)
  return cleanUnderstood(JSON.parse(json))
}

export async function translate(text: string, to: VoiceLang) {
  const j = await post('/translate', { input: text.slice(0, 2000), source_language_code: 'en-IN', target_language_code: to, model: 'sarvam-translate:v1' })
  if (typeof j?.translated_text !== 'string' || !j.translated_text) throw new Error('Sarvam translate returned no text')
  return j.translated_text as string
}

export async function speak(text: string, lang: VoiceLang) {
  const j = await post('/text-to-speech', { text: text.slice(0, 2500), language_code: lang, model: 'bulbul:v3', speaker: 'priya' })
  if (!Array.isArray(j?.audios) || !j.audios.length) throw new Error('Sarvam TTS returned no audio')
  return Buffer.from(j.audios.join(''), 'base64')
}
