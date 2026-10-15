import { timingSafeEqual } from 'node:crypto'

const int = (v: string | undefined, d: number, min = 1, max = 1000) => {
  const n = Number(v)
  return Number.isInteger(n) && n >= min && n <= max ? n : d
}

export const cfg = {
  maxCalls: int(process.env.MAX_CALLS_PER_REQUEST, 5, 1, 8),
  maxConcurrency: int(process.env.MAX_CONCURRENCY, 8, 1, 50),
  maxLivePerDay: int(process.env.MAX_LIVE_CALLS_PER_DAY, 25, 1, 500),
  watchdogSec: int(process.env.CALL_WATCHDOG_SECONDS, 300, 120, 3600), // never shorter than a 90 s call
  callWindow: /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(process.env.CALL_WINDOW_IST ?? '') ? process.env.CALL_WINDOW_IST! : '09:00-20:00',
}

// "HH:MM-HH:MM" in IST (UTC+5:30, no DST). Default 09:00–20:00, inside TRAI's 9 AM–9 PM guidance.
export function inCallingWindow(now = new Date(), window = cfg.callWindow) {
  const [start, end] = window.split('-').map((t) => {
    const [h, m] = t.split(':').map(Number)
    return h * 60 + m
  })
  const ist = (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) % 1440
  return ist >= start && ist < end
}

export const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

// Privileged routes (live calls, labels, exports) need the operator token. No token configured = locked.
export function isAdmin(req: Request) {
  const token = process.env.POOCHHO_ADMIN_TOKEN
  const given = req.headers.get('x-admin-token')
  return Boolean(token && token.length >= 12 && given && safeEqual(given, token))
}

// Why LIVE calling is unavailable, if it is. Empty list = ready.
export function liveBlockers() {
  const out: string[] = []
  if (process.env.LIVE_CALLS_ENABLED !== 'true') out.push('LIVE_CALLS_ENABLED is not "true"')
  if (!process.env.BOLNA_API_KEY) out.push('BOLNA_API_KEY is missing')
  if (!process.env.BOLNA_AGENT_ID) out.push('BOLNA_AGENT_ID is missing')
  if ((process.env.POOCHHO_ADMIN_TOKEN ?? '').length < 12) out.push('POOCHHO_ADMIN_TOKEN (12+ characters) is missing')
  if (!process.env.BOLNA_WEBHOOK_SECRET) out.push('BOLNA_WEBHOOK_SECRET is missing (webhooks would be rejected)')
  return out
}
