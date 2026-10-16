// MOCKED: the engine and Bolna are stubs, so this only tests the recording route's own rules.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const recordingId = vi.fn()
const getRecording = vi.fn()
vi.mock('@/lib/engine', () => ({ recordingId, isUuid: (s: string) => /^[0-9a-f-]{36}$/.test(s), errorResponse: () => Response.json({}, { status: 500 }) }))
vi.mock('@/lib/bolna', () => ({ getRecording }))
const { GET } = await import('@/app/api/executions/[id]/recording/route')

const ID = '0b8f5c2e-7d1a-4f3b-9c6e-2a1d3e4f5a6b'
const TOKEN = 'test-operator-token-123'
const call = (headers: Record<string, string> = { 'x-admin-token': TOKEN }) => GET(new Request(`http://localhost/api/executions/${ID}/recording`, { headers }), { params: Promise.resolve({ id: ID }) })

beforeEach(() => {
  recordingId.mockReset()
  getRecording.mockReset()
  process.env.POOCHHO_ADMIN_TOKEN = TOKEN
})

describe('GET /api/executions/[id]/recording', () => {
  it('is for the operator only', async () => {
    expect((await call({})).status).toBe(401)
    expect((await call({ 'x-admin-token': 'wrong-token-xyz' })).status).toBe(401)
    expect(recordingId).not.toHaveBeenCalled()
  })

  it('answers 404 unless it is an answered LIVE call with a recording', async () => {
    recordingId.mockResolvedValueOnce(null)
    expect((await call()).status).toBe(404)
    expect(getRecording).not.toHaveBeenCalled()
    recordingId.mockResolvedValueOnce('bolna-1')
    getRecording.mockResolvedValueOnce(null)
    expect((await call()).status).toBe(404)
  })

  it('streams the audio through, uncached, fetched fresh for each play', async () => {
    recordingId.mockResolvedValue('bolna-1')
    getRecording.mockImplementation(async () => new Response('ID3audio', { headers: { 'content-type': 'audio/mpeg' } }))
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('audio/mpeg')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(await res.text()).toBe('ID3audio')
    await call()
    expect(getRecording).toHaveBeenCalledTimes(2)
    expect(getRecording).toHaveBeenCalledWith('bolna-1')
  })
})
