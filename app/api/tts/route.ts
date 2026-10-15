import { sarvamConfigured, speak } from '@/lib/sarvam'

// Spoken summary via Sarvam. 501 tells the browser to use speechSynthesis instead.
export async function POST(req: Request) {
  if (!sarvamConfigured()) return Response.json({ error: 'Sarvam is not configured' }, { status: 501 })
  const body = await req.json().catch(() => null)
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (!text || text.length > 2500) return Response.json({ error: 'Text must be 1–2500 characters.' }, { status: 400 })
  try {
    const wav = await speak(text, body.lang === 'en' ? 'en' : 'hi')
    return new Response(new Uint8Array(wav), { headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error((e as Error).message)
    return Response.json({ error: 'Speech failed.' }, { status: 502 })
  }
}
