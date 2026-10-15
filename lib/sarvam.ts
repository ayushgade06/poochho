// Sarvam AI speech (docs.sarvam.ai): STT POST /speech-to-text (multipart, ≤30 s audio), TTS POST /text-to-speech
// (JSON → base64 WAV). Server-side only; the browser falls back to its own speech APIs when this is not configured.
const BASE = 'https://api.sarvam.ai'
const LANG: Record<string, string> = { hi: 'hi-IN', en: 'en-IN' }
export const sarvamConfigured = () => Boolean(process.env.SARVAM_API_KEY)
const headers = () => ({ 'api-subscription-key': process.env.SARVAM_API_KEY! })

export async function transcribe(audio: Blob, lang: string) {
  const form = new FormData()
  form.append('file', audio, 'speech.webm')
  form.append('model', 'saaras:v4')
  form.append('language_code', LANG[lang] ?? 'unknown')
  const res = await fetch(`${BASE}/speech-to-text`, { method: 'POST', headers: headers(), body: form, signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`Sarvam STT ${res.status}`)
  const j = await res.json()
  return typeof j?.transcript === 'string' ? j.transcript.trim() : ''
}

export async function speak(text: string, lang: string) {
  const res = await fetch(`${BASE}/text-to-speech`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text.slice(0, 2500), language_code: LANG[lang] ?? 'hi-IN', model: 'bulbul:v3', speaker: 'priya' }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`Sarvam TTS ${res.status}`)
  const j = await res.json()
  if (!Array.isArray(j?.audios) || !j.audios.length) throw new Error('Sarvam TTS returned no audio')
  return Buffer.from(j.audios.join(''), 'base64')
}
