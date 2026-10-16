import { describe, expect, it } from 'vitest'
import { parseSpokenRequest } from '@/lib/voice'
import { cleanUnderstood } from '@/lib/sarvam'

describe('parseSpokenRequest', () => {
  it('reads quantity, unit and product in either order', () => {
    expect(parseSpokenRequest('2 packets of Amul butter')).toEqual({ quantity: 2, unit: 'packet', product: 'Amul butter' })
    expect(parseSpokenRequest('Amul butter 2 packet')).toEqual({ quantity: 2, unit: 'packet', product: 'Amul butter' })
  })

  it('understands Hindi and Hinglish numbers', () => {
    expect(parseSpokenRequest('मुझे दो पैकेट अमूल बटर चाहिए।')).toEqual({ quantity: 2, unit: 'packet', product: 'अमूल बटर' })
    expect(parseSpokenRequest('mujhe do kilo pyaaz chahiye')).toEqual({ quantity: 2, unit: 'kg', product: 'pyaaz' })
  })

  it('does not read the English word "do" as a number', () => {
    expect(parseSpokenRequest('do you have paracetamol 3 strips')).toEqual({ quantity: 3, unit: 'strip', product: 'do you have paracetamol' })
  })

  it('keeps numbers that are part of a product name', () => {
    expect(parseSpokenRequest('Dolo 650')).toEqual({ product: 'Dolo 650' })
    expect(parseSpokenRequest('Dolo 650 2 strips')).toEqual({ quantity: 2, unit: 'strip', product: 'Dolo 650' })
    expect(parseSpokenRequest('2 Amul butter')).toEqual({ quantity: 2, product: 'Amul butter' })
  })

  it('leaves out what it did not hear', () => {
    expect(parseSpokenRequest('')).toEqual({})
    expect(parseSpokenRequest('kilo sugar')).toEqual({ unit: 'kg', product: 'sugar' })
  })
})

describe('cleanUnderstood (Sarvam model output)', () => {
  it('keeps only known keys, enum values and sane numbers', () => {
    expect(cleanUnderstood({ product: ' Amul Butter ', quantity: 2, unit: 'packet', category: 'grocery', city: 'Pune', area: 'Kothrud', brand_or_variant: null })).toEqual({ product: 'Amul Butter', quantity: 2, unit: 'packet', category: 'grocery', city: 'Pune', area: 'Kothrud' })
    expect(cleanUnderstood({ product: 'x'.repeat(500), quantity: -3, unit: 'tonne', category: 'weapons', shop_ids: ['a'], phone: '999' })).toEqual({ product: 'x'.repeat(120) })
    expect(cleanUnderstood(null)).toEqual({})
    expect(cleanUnderstood({ quantity: '2' })).toEqual({})
  })
})
