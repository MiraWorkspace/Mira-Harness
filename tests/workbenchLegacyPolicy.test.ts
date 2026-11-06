import { describe, expect, it } from 'vitest'
import { legacyDataCleared, markLegacyDataCleared, WORKBENCH_LEGACY_CLEARED_KEY } from '../electron/services/workbenchLegacyPolicy'

describe('Workbench legacy backup after data clearing', () => {
  it('suppresses automatic import only for the explicitly cleared Workbench identity', () => {
    const preferences = { [WORKBENCH_LEGACY_CLEARED_KEY]: markLegacyDataCleared({}, 'mira-workbench') }
    expect(legacyDataCleared(preferences, 'mira-workbench')).toBe(true)
    expect(legacyDataCleared(preferences, 'mira-workbench-test')).toBe(false)
    expect(legacyDataCleared(preferences, 'other')).toBe(false)
    expect(markLegacyDataCleared(preferences, 'mira-workbench-test')).toEqual(['mira-workbench', 'mira-workbench-test'])
  })
})
