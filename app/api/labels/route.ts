import { isAdmin } from '@/lib/config'
import { errorResponse, isUuid, labelQueue, saveLabel } from '@/lib/engine'

const MODES = ['live', 'simulated', 'replay']
const deny = () => Response.json({ error: 'The operator token is missing or wrong.' }, { status: 401 })

// Manual ground-truth labels for extraction accuracy. Operator-only: the queue includes transcripts.
export async function GET(req: Request) {
  if (!isAdmin(req)) return deny()
  const mode = new URL(req.url).searchParams.get('mode') ?? 'live'
  if (!MODES.includes(mode)) return Response.json({ error: 'Unknown mode.' }, { status: 400 })
  try {
    return Response.json({ calls: await labelQueue(mode) })
  } catch (e) {
    return errorResponse(e)
  }
}

export async function POST(req: Request) {
  if (!isAdmin(req)) return deny()
  const b = await req.json().catch(() => null)
  if (!b || !isUuid(String(b.execution_id)) || typeof b.field !== 'string' || typeof b.is_correct !== 'boolean') return Response.json({ error: 'Expected execution_id, field and is_correct.' }, { status: 400 })
  try {
    await saveLabel(b.execution_id, b.field, b.is_correct, typeof b.correct_value === 'string' ? b.correct_value : null)
    return Response.json({ ok: true })
  } catch (e) {
    return errorResponse(e)
  }
}
