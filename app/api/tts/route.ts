import { errorResponse, getSearch, isUuid } from '@/lib/engine'
import { sarvamConfigured, speak } from '@/lib/sarvam'
import { searchSummary } from '@/lib/summary'

// Spoken summary via Sarvam. It speaks only the server-computed summary of an existing search, so it can't
// be used as a general text-to-speech proxy on the operator's key. 501 means "use the browser's voice".
export async function POST(req: Request) {
  if (!sarvamConfigured()) return Response.json({ error: 'Sarvam is not configured' }, { status: 501 })
  const body = await req.json().catch(() => null)
  const id = typeof body?.search_id === 'string' ? body.search_id : ''
  if (!isUuid(id)) return Response.json({ error: 'search_id is required.' }, { status: 400 })
  try {
    const s = await getSearch(id)
    if (!s) return Response.json({ error: 'Not found.' }, { status: 404 })
    const wav = await speak(searchSummary(s), s.request.language)
    return new Response(new Uint8Array(wav), { headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(e)
  }
}
