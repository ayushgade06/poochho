import { isAdmin } from '@/lib/config'
import { withinDailyCap } from '@/lib/engine'
import { sarvamConfigured, transcribe, understand } from '@/lib/sarvam'

// Voice input via Sarvam, open to everyone so judges can speak in any Indian language, but capped per visitor and
// per day so the paid key can't be drained (the operator is not capped). On 501 or 429 the browser switches to its
// own speech recognition. The language is auto-detected (11 Indian languages) and one sentence becomes
// form fields; `fields: null` means "use the local parser".
export async function POST(req: Request) {
  if (!sarvamConfigured()) return Response.json({ error: 'Sarvam is not configured' }, { status: 501 })
  const capped = !isAdmin(req) && !(await withinDailyCap('voice', req).catch(() => false))
  if (capped) return Response.json({ error: "Today's voice inputs are used up." }, { status: 429 })
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
