import { isAdmin } from '@/lib/config'
import { withinDailyCap } from '@/lib/engine'
import { sarvamConfigured, understand } from '@/lib/sarvam'

// One typed sentence ("2 packet Amul Butter, Kothrud, Pune") → form fields, the same Sarvam step spoken requests use.
// The model's output is reduced to known fields and the user checks every one before anything is called. It has
// its own daily caps (typing is the main path, so it mustn't use up voice input's). On 501 or 429 the browser falls
// back to its local parser.
export async function POST(req: Request) {
  if (!sarvamConfigured()) return Response.json({ error: 'Sarvam is not configured' }, { status: 501 })
  const body = await req.json().catch(() => null)
  const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 300) : ''
  if (!text) return Response.json({ error: 'Type what you need.' }, { status: 400 })
  if (!isAdmin(req) && !(await withinDailyCap('text', req).catch(() => false))) return Response.json({ error: "Today's limit is used up." }, { status: 429 })
  try {
    return Response.json({ fields: await understand(text) })
  } catch (e) {
    console.error((e as Error).message)
    return Response.json({ error: 'Could not understand that. Please fill in the details.' }, { status: 502 })
  }
}
