import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { miraHome } from '../electron/bootstrap/miraHome'

describe('Mira data home selection', () => {
  it('requires explicit opt-in for a packaged test home', () => {
    const env = { MIRA_TEST_HOME: './isolated' }
    expect(miraHome(true, env, '/user-home')).toBe('/user-home')
    expect(miraHome(true, { ...env, MIRA_PACKAGED_TEST_MODE: '0' }, '/user-home')).toBe('/user-home')
    expect(miraHome(true, { ...env, MIRA_PACKAGED_TEST_MODE: '1' }, '/user-home')).toBe(resolve('./isolated'))
    expect(miraHome(false, env, '/user-home')).toBe(resolve('./isolated'))
    expect(miraHome(true, { MIRA_PACKAGED_TEST_MODE: '1' }, '/user-home')).toBe('/user-home')
  })
})
