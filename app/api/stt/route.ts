import { sarvamConfigured, transcribe } from '@/lib/sarvam'

// Voice input via Sarvam. 501 tells the browser to use its own speech recognition instead.
export async function POST(req: Request) {
  if (!sarvamConfigured()) return Response.json({ error: 'Sarvam is not configured' }, { status: 501 })
  const form = await req.formData().catch(() => null)
  const audio = form?.get('audio')
  if (!(audio instanceof Blob) || !audio.size) return Response.json({ error: 'No audio received.' }, { status: 400 })
  if (audio.size > 2_000_000) return Response.json({ error: 'Recording too long (30 seconds max).' }, { status: 413 })
  try {
    return Response.json({ transcript: await transcribe(audio, String(form?.get('lang') ?? 'hi')) })
  } catch (e) {
    console.error((e as Error).message)
    return Response.json({ error: 'Transcription failed. Please type your request.' }, { status: 502 })
  }
}
