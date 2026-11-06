export const WORKBENCH_LEGACY_CLEARED_KEY = 'workbenchLegacyDataCleared'

export function isWorkbenchId(id: string) { return id === 'mira-workbench' || id === 'mira-workbench-test' }

export function legacyDataCleared(preferences: Record<string, unknown>, id: string) {
  const value = preferences[WORKBENCH_LEGACY_CLEARED_KEY]
  return isWorkbenchId(id) && Array.isArray(value) && value.includes(id)
}

export function markLegacyDataCleared(preferences: Record<string, unknown>, id: string) {
  const value = preferences[WORKBENCH_LEGACY_CLEARED_KEY]
  const ids = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && isWorkbenchId(item)) : []
  return [...new Set([...ids, id])]
}
