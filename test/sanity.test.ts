import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

describe('environment', () => {
  it('has node:sqlite', () => {
    const db = new DatabaseSync(':memory:')
    expect(db.prepare('select 1 as x').get()).toEqual({ x: 1 })
  })
})
