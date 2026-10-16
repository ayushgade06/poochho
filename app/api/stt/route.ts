import { isAdmin } from '@/lib/config'
import { sarvamConfigured, transcribe, understand } from '@/lib/sarvam'

// Voice input via Sarvam, operator-only so the paid key can't be used as an open proxy. 501 or 401 tells
// the browser to use its own speech recognition instead. The language is auto-detected (11 Indian languages)
// and one sentence becomes form fields; `fields: null` means "use the local parser".
export async function POST(req: Request) {
  if (!sarvamConfigured()) return Response.json({ error: 'Sarvam is not configured' }, { status: 501 })
  if (!isAdmin(req)) return Response.json({ error: 'Sarvam voice input needs the operator token.' }, { status: 401 })
  const form = await req.formData().catch(() => null)
  const audio = form?.get('audio')
  if (!(audio instanceof Blob) || !audio.size) return Response.json({ error: 'No audio received.' }, { status: 400 })
  if (audio.size > 2_000_000) return Response.json({ error: 'Recording too long (30 seconds max).' }, { status: 413 })
  try {
    const { transcript, language } = await transcribe(audio)
    const fields = transcript ? await understand(transcript).catch((e) => (console.error((e as Error).message), null)) : null
    return Response.json({ transcript, language, fields })
  } catch (e) {
    console.error((e as Error).message)
    return Response.json({ error: 'Transcription failed. Please type your request.' }, { status: 502 })
  }
}
