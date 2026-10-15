// Integration: real Supabase (persistence, RLS, Realtime). SIMULATED mode only; no phone calls are possible
// because BOLNA_API_KEY is cleared in vitest.integration.mts.
import { createClient } from '@supabase/supabase-js'
import { afterAll, describe, expect, it } from 'vitest'
import { applyEvent, callable, createHold, createSearch, db, getSearch, listShops, tick, UserError } from '@/lib/engine'
import { rankResults } from '@/lib/rank'
import { DEMO_SHOPS } from '@/lib/sim'

const created: string[] = []
const TEST_SHOP = 'zz-test-live-shop'
const base = { mode: 'simulated' as const, product: 'Amul Butter', brand_or_variant: '500g', category: 'grocery', quantity: 2, unit: 'packet', city: 'Pune', area: 'Kothrud', language: 'hi' as const, max_budget_inr: null, need_within_minutes: null, constraints: null }
const five = ['demo-sharma-kirana', 'demo-gupta-general', 'demo-patil-provision', 'demo-new-bharat', 'demo-mehta-general']

// Make every scripted step due now, instead of waiting ~25 s of simulated call time.
const fastForward = async (requestId: string) => {
  const r = await db().from('call_executions').update({ dispatched_at: new Date(Date.now() - 120_000).toISOString() }).eq('request_id', requestId)
  if (r.error) throw new Error(r.error.message)
}

afterAll(async () => {
  if (created.length) await db().from('search_requests').delete().in('id', created)
  await db().from('shops').delete().eq('id', TEST_SHOP)
})

describe('SIMULATED search end to end', () => {
  let id = ''

  it('persists a search with one execution per shop', async () => {
    id = await createSearch({ ...base, shop_ids: five })
    created.push(id)
    const s = (await getSearch(id))!
    expect(s.request).toMatchObject({ mode: 'simulated', product: 'Amul Butter', quantity: 2 })
    expect(s.executions).toHaveLength(5)
    expect(s.executions.every((e) => e.status === 'dispatching' && e.shop?.name)).toBe(true)
    expect(s.executions.some((e) => 'script' in e || 'version' in e)).toBe(false) // the scripted future is never sent to clients
  })

  it('delivers each scripted step exactly once even when two tabs tick concurrently', async () => {
    await fastForward(id)
    await Promise.all([tick(id), tick(id)])
    await tick(id)
    const s = (await getSearch(id))!
    const by = Object.fromEntries(s.executions.map((e) => [e.shop_id, e]))
    expect(by['demo-sharma-kirana']).toMatchObject({ status: 'done', provider_status: 'completed' })
    expect(by['demo-sharma-kirana'].extracted).toMatchObject({ in_stock: 'yes', can_hold: 'yes', confidence: 'high' })
    expect(by['demo-patil-provision'].extracted).toMatchObject({ in_stock: 'partial', qty_available: 1 })
    expect(by['demo-mehta-general'].extracted?.total_price_inr ?? by['demo-mehta-general'].extracted?.unit_price_inr).toBeNull()
    expect(by['demo-new-bharat']).toMatchObject({ status: 'failed', error: 'no-answer' })
    expect(by['demo-sharma-kirana'].transcript).toContain('AI assistant')

    const ids = s.executions.map((e) => e.id)
    const ev = await db().from('call_events').select('execution_id').in('execution_id', ids)
    const sharmaEvents = ev.data!.filter((r) => r.execution_id === by['demo-sharma-kirana'].id).length
    expect(sharmaEvents).toBe(6) // queued, initiated, ringing, in-progress, call-disconnected, completed: no duplicates
  })

  it('ranks the verified results deterministically', async () => {
    const s = (await getSearch(id))!
    const ranked = rankResults(s.request, s.executions.map((e) => ({ id: e.id, shopName: e.shop.name, status: e.status, error: e.error, extracted: e.extracted })))
    expect(ranked.find((r) => r.winner)?.shopName).toBe('Sharma Kirana Store')
    expect(ranked.find((r) => r.shopName === 'Patil Provision')?.eligible).toBe(false)
  })

  it('ignores duplicate and stale out-of-order provider events', async () => {
    const s = (await getSearch(id))!
    const sharma = s.executions.find((e) => e.shop_id === 'demo-sharma-kirana')!
    const before = await db().from('call_executions').select('version').eq('id', sharma.id).single()
    expect(await applyEvent({ id: sharma.id }, { status: 'completed', transcript: sharma.transcript, extracted_data: sharma.extracted, duration: sharma.duration_seconds }, 'webhook')).toEqual({ id: sharma.id, changed: false })
    expect(await applyEvent({ id: sharma.id }, { status: 'ringing' }, 'webhook')).toEqual({ id: sharma.id, changed: false })
    expect(await applyEvent({ providerId: sharma.provider_execution_id! }, { status: 'in-progress' }, 'webhook')).toEqual({ id: sharma.id, changed: false })
    const after = await db().from('call_executions').select('version, status').eq('id', sharma.id).single()
    expect(after.data).toEqual({ version: before.data!.version, status: 'done' })
    expect(await applyEvent({ providerId: 'unknown-provider-id' }, { status: 'completed' }, 'webhook')).toBeNull()
  })

  it('places one hold call per shop and reports the shop’s answer', async () => {
    const s = (await getSearch(id))!
    const sharma = s.executions.find((e) => e.shop_id === 'demo-sharma-kirana')!
    const failed = s.executions.find((e) => e.shop_id === 'demo-new-bharat')!
    await expect(createHold(failed.id)).rejects.toBeInstanceOf(UserError)
    await createHold(sharma.id)
    await expect(createHold(sharma.id)).rejects.toThrow(/already placed/)
    await fastForward(id)
    await tick(id)
    const hold = (await getSearch(id))!.executions.find((e) => e.kind === 'hold')!
    expect(hold).toMatchObject({ status: 'done', shop_id: 'demo-sharma-kirana' })
    expect(hold.extracted?.can_hold).toBe('yes')
  })
})

describe('consent and opt-out enforcement', () => {
  it('suppresses a number that asked not to be called, across searches', async () => {
    // A fake, never-dialled number: this test cannot place calls (no Bolna key) and stops before dispatch.
    const ins = await db().from('shops').upsert({ id: TEST_SHOP, name: 'Test Live Shop', area: 'Test', source: 'live', phone: '+910000000001', consent_status: 'verified', consent_verified_at: new Date().toISOString(), opted_out_at: null })
    expect(ins.error).toBeNull()
    expect((await listShops('live')).find((s) => s.id === TEST_SHOP)?.callable).toBe(true)

    const req = await db().from('search_requests').insert({ ...base }).select('id').single()
    created.push(req.data!.id)
    const ex = await db().from('call_executions').insert({ request_id: req.data!.id, shop_id: TEST_SHOP, mode: 'simulated', status: 'talking' }).select('id').single()
    await applyEvent({ id: ex.data!.id }, { status: 'completed', duration: 12, extracted_data: { Q: { in_stock: { objective: 'unsure', subjective: '' }, opt_out: { objective: 'yes', subjective: '' } } } }, 'webhook')

    const shop = await db().from('shops').select('*').eq('id', TEST_SHOP).single()
    expect(shop.data!.opted_out_at).not.toBeNull()
    expect(callable(shop.data)).toBe(false)
    expect((await listShops('live')).find((s) => s.id === TEST_SHOP)).toMatchObject({ callable: false, note: 'Opted out of calls' })
    await expect(createSearch({ ...base, mode: 'live', shop_ids: [TEST_SHOP] })).rejects.toThrow(/Not eligible/)
    // Re-including the number in a new search does not clear the opt-out.
    expect((await db().from('shops').select('opted_out_at').eq('id', TEST_SHOP).single()).data!.opted_out_at).not.toBeNull()
  })
})

describe('Supabase Realtime and RLS', () => {
  it('pushes a broadcast to the search channel when a call changes, with no data exposed', async () => {
    const browser = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
    const denied = await browser.from('call_executions').select('id').limit(1)
    expect(denied.error?.code).toBe('42501') // the publishable key cannot read transcripts or phone numbers

    const id = await createSearch({ ...base, shop_ids: [DEMO_SHOPS[0].id] })
    created.push(id)
    const got: unknown[] = []
    const channel = browser.channel(`search:${id}`).on('broadcast', { event: 'call_changed' }, (m) => got.push(m.payload))
    await new Promise<void>((resolve, reject) => channel.subscribe((s) => (s === 'SUBSCRIBED' ? resolve() : s !== 'CLOSED' && reject(new Error(s)))))
    await new Promise((r) => setTimeout(r, 1000))
    await fastForward(id)
    await tick(id)
    for (let i = 0; i < 40 && !got.length; i++) await new Promise((r) => setTimeout(r, 250))
    await browser.removeAllChannels()
    expect(got.length).toBeGreaterThan(0)
    expect(Object.keys(got[0] as object).sort()).toEqual(['execution_id', 'id', 'status'].filter((k) => k in (got[0] as object)).sort())
  })
})
