import type { Router } from 'vue-router'
import type { AppsState } from '@/config/miraApps'
import { applyPlatformSnapshot } from '@/config/runtime'
import { getAppCodeFromPath } from '@/config/navigation'
import { getPlatformApi } from '@/platform'
import { HARNESS_WORKBENCH_PATH } from './firstPartyNavigation'

export function observeLocalApps(router: Router) {
  const apps = getPlatformApi()?.apps
  if (!apps?.onChanged) return () => {}
  let active = true
  const receive = (state: AppsState) => {
    if (!active) return
    applyPlatformSnapshot(state.snapshot)
    const missing = (path: string) => {
      const code = getAppCodeFromPath(path.split(/[?#]/)[0])
      return code !== 'main' && !state.snapshot.microApps.some(app => app.code === code && app.enabled)
    }
    const route = router.currentRoute.value
    if (missing(route.path)) void router.replace(HARNESS_WORKBENCH_PATH)
    else if (typeof route.query.from === 'string' && missing(route.query.from)) {
      void router.replace({ path: route.path, query: { ...route.query, from: HARNESS_WORKBENCH_PATH } })
    }
  }
  const unsubscribe = apps.onChanged(receive)
  // Subscribe before scanning so a deletion during renderer startup cannot be missed.
  void apps.scan().then(receive).catch(() => {})
  return () => { active = false; unsubscribe() }
}
