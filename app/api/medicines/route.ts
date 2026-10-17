import { db, errorResponse } from '@/lib/engine'
import { alternativesAllowed, type Medicine } from '@/lib/medicine'

// Medicine lookup for pharmacy requests (the medicines table is closed to the browser): at least 3 characters,
// at most 10 results with name, composition, strength and form, and whether Poochho may ask a shop for the same
// composition under another brand.
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get('q') ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
  if (q.length < 3) return Response.json({ error: 'Type at least 3 characters.' }, { status: 400 })
  try {
    const { data, error } = await db().rpc('search_medicines', { q })
    if (error) throw new Error(error.message)
    return Response.json({ medicines: (data as Medicine[]).map((m) => ({ ...m, allowed: alternativesAllowed(m) })) })
  } catch (e) {
    return errorResponse(e)
  }
}
