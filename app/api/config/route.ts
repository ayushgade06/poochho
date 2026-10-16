import { connection } from 'next/server'
import { cfg, inCallingWindow, liveBlockers, webCallEnabled } from '@/lib/config'
import { REPLAYS } from '@/lib/engine'
import { sarvamConfigured } from '@/lib/sarvam'

// What the UI may offer. Reports which settings are missing, never their values.
export async function GET() {
  await connection()
  return Response.json({
    live: { blockers: liveBlockers(), inWindow: inCallingWindow(), window: cfg.callWindow },
    speech: sarvamConfigured() ? 'sarvam' : 'browser',
    judge: webCallEnabled(),
    maxCalls: cfg.maxCalls,
    replays: REPLAYS.map(({ id, title, source, recorded_at }) => ({ id, title, source, recorded_at })),
  })
}
