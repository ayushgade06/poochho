import { errorResponse, getSearch, isUuid } from '@/lib/engine'
import { sarvamConfigured, speak, translate } from '@/lib/sarvam'
import { searchSummary } from '@/lib/summary'
import { VOICE_LANGS, type VoiceLang } from '@/lib/types'

// Spoken summary via Sarvam. It speaks only the server-computed summary of an existing search, so it can't
// be used as a general text-to-speech proxy on the operator's key. Hindi and English are spoken as written;
// other languages are machine-translated from the English summary. 501 means "use the browser's voice".
export async function POST(req: Request) {
  if (!sarvamConfigured()) return Response.json({ error: 'Sarvam is not configured' }, { status: 501 })
  const body = await req.json().catch(() => null)
  const id = typeof body?.search_id === 'string' ? body.search_id : ''
  if (!isUuid(id)) return Response.json({ error: 'search_id is required.' }, { status: 400 })
  try {
    const s = await getSearch(id)
    if (!s) return Response.json({ error: 'Not found.' }, { status: 404 })
    const lang: VoiceLang = body?.lang in VOICE_LANGS ? body.lang : s.request.language === 'en' ? 'en-IN' : 'hi-IN'
    const text = lang === 'hi-IN' || lang === 'en-IN' ? searchSummary(s, lang === 'hi-IN' ? 'hi' : 'en') : await translate(searchSummary(s, 'en'), lang)
    const wav = await speak(text, lang)
    return Response.json({ lang, text, translated: lang !== 'hi-IN' && lang !== 'en-IN', audio: wav.toString('base64') }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(e)
  }
}
