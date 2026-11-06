<template>
  <SettingsPageShell title="应用扩展" wide :show-title="false">
    <div class="app-extensions">
      <header class="app-extensions__header">
        <h1>应用扩展</h1>
        <div class="app-extensions__tools">
          <button class="app-extensions__refresh" type="button" aria-label="检查更新" :aria-busy="checking" @click="refresh"><span class="app-extensions__refresh-icon" :class="{ 'is-spinning': checking }"><AppIcon name="lucide:refresh-cw" :size="18" aria-hidden="true" /></span></button>
          <label class="app-extensions__search"><AppIcon name="lucide:search" aria-hidden="true" /><input v-model="query" type="search" placeholder="搜索应用…" aria-label="搜索应用" /></label>
        </div>
      </header>

      <nav class="app-extensions__tabs" role="tablist" aria-label="应用分类">
        <button v-for="item in tabs" :id="`apps-tab-${item.id}`" :key="item.id" type="button" role="tab" :aria-selected="activeTab === item.id" :aria-controls="`apps-panel-${item.id}`" :class="{ 'is-active': activeTab === item.id }" @click="activeTab = item.id">
          {{ item.label }}<span v-if="item.count" class="app-extensions__tab-count">{{ item.count }}</span><span v-if="item.hasUpdate" class="app-extensions__tab-update" aria-label="有可用更新" />
        </button>
      </nav>

      <div v-if="pendingRestartCount" class="app-extensions__restart-notice" role="status">
        <span><AppIcon name="lucide:rotate-cw" :size="18" aria-hidden="true" />{{ pendingRestartCount }}个应用需要重启 Mira 才能生效。</span>
        <button type="button" class="app-extensions__restart" @click="restart">立即重启</button>
      </div>

      <section :id="`apps-panel-${activeTab}`" class="app-extensions__panel" role="tabpanel" :aria-labelledby="`apps-tab-${activeTab}`">
        <div v-if="visibleCards.length" class="app-extensions__grid">
          <article v-for="application in visibleCards" :key="application.id" class="app-card">
            <header class="app-card__header">
              <div class="app-card__identity">
                <span class="app-card__icon"><img v-if="application.icon" :src="application.icon" alt="" /><AppIcon v-else name="lucide:app-window" :size="20" aria-hidden="true" /></span>
                <h2 :title="application.name">{{ application.name }} <DevBadge v-if="application.test" /></h2>
              </div>
              <el-dropdown v-if="application.test" trigger="click" placement="bottom-end" :show-arrow="false" popper-class="app-extensions-menu" @command="openDirectory(application.id)">
                <button type="button" class="app-card__more" :aria-label="`${application.name} 更多操作`"><AppIcon name="lucide:ellipsis" :size="18" aria-hidden="true" /></button>
                <template #dropdown><el-dropdown-menu><el-dropdown-item :command="application.id">打开目录</el-dropdown-item></el-dropdown-menu></template>
              </el-dropdown>
              <el-dropdown v-else-if="application.installed" trigger="click" placement="bottom-end" :show-arrow="false" popper-class="app-extensions-menu" @command="(command: InstalledMenuAction) => handleInstalledMenu(application, command)">
                <button type="button" class="app-card__more" :aria-label="`${application.name} 更多操作`"><AppIcon name="lucide:ellipsis" :size="18" aria-hidden="true" /></button>
                <template #dropdown><el-dropdown-menu>
                  <el-dropdown-item command="github" :disabled="!application.repository">在 GitHub 查看</el-dropdown-item>
                  <el-dropdown-item :command="application.blocked ? 'unblock' : 'block'">{{ application.blocked ? '取消屏蔽' : '屏蔽' }}</el-dropdown-item>
                  <el-dropdown-item command="clear-data">清除应用数据</el-dropdown-item>
                  <el-dropdown-item command="uninstall" divided class="is-danger" :disabled="application.restart === 'uninstall' || removing === application.id">卸载</el-dropdown-item>
                </el-dropdown-menu></template>
              </el-dropdown>
              <button v-else-if="application.release" type="button" class="app-card__action" :aria-label="`安装 ${application.name}`" @click="install(application)">{{ installing === application.id ? '安装中…' : '安装' }}</button>
              <span v-else class="app-card__unavailable">暂不兼容</span>
            </header>
            <div class="app-card__meta"><span><AppIcon name="lucide:tag" :size="13" aria-hidden="true" />v{{ application.version || '未知' }}</span><span><AppIcon name="lucide:package" :size="13" aria-hidden="true" />{{ sizeLabel(application.sizeBytes) }}</span></div>
            <p class="app-card__description">{{ application.description || '暂无应用描述。' }}</p>
            <p v-if="application.updateError" role="alert">{{ application.updateError }}</p>
            <footer class="app-card__footer">
              <span />
              <template v-if="application.installed && !application.test">
                <span v-if="application.restart === 'install'" class="app-card__status is-restart"><AppIcon name="lucide:check" :size="14" aria-hidden="true" />已更新，重启后生效</span>
                <span v-else-if="application.restart === 'uninstall'" class="app-card__status is-restart"><AppIcon name="lucide:clock-3" :size="14" aria-hidden="true" />等待重启</span>
                <button v-else-if="application.hasUpdate" type="button" class="app-card__action" :aria-label="`更新 ${application.name}`" @click="install(application)">{{ installing === application.id ? '更新中…' : '更新' }}</button>
                <span v-else class="app-card__status"><AppIcon name="lucide:check" :size="14" aria-hidden="true" />已是最新</span>
              </template>
              <el-dropdown v-else-if="!application.test" trigger="click" placement="bottom-end" :show-arrow="false" popper-class="app-extensions-menu" @command="(command: 'block' | 'unblock') => setBlocked(application.id, command === 'block')">
                <button type="button" class="app-card__more" :aria-label="`${application.name} 更多操作`"><AppIcon name="lucide:ellipsis" :size="18" aria-hidden="true" /></button>
                <template #dropdown><el-dropdown-menu><el-dropdown-item :command="application.blocked ? 'unblock' : 'block'">{{ application.blocked ? '取消屏蔽' : '屏蔽' }}</el-dropdown-item></el-dropdown-menu></template>
              </el-dropdown>
            </footer>
          </article>
        </div>
        <el-empty v-else :description="emptyDescription" :image-size="72" />
      </section>
    </div>
  </SettingsPageShell>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ElMessageBox, ElNotification } from 'element-plus'
import SettingsPageShell from '../settings/components/SettingsPageShell.vue'
import DevBadge from '@/components/DevBadge.vue'
import { getPlatformApi } from '@/platform'
import { applyPlatformSnapshot } from '@/config/runtime'
import { compareAppVersions, compatibleAppRelease, type AppRelease, type AppsState, type CatalogApp, type InstalledApp } from '@/config/miraApps'
import { version as shellVersion } from '../../../../package.json'

type AppTab = 'discover' | 'installed' | 'blocked' | 'debug'
interface AppCard {
  id: string
  name: string
  description?: string
  icon?: string
  version?: string
  sizeBytes: number | null
  installed: boolean
  test: boolean
  blocked: boolean
  hasUpdate: boolean
  restart?: 'install' | 'uninstall'
  release?: AppRelease
  repository?: string
  updateError?: string
}
type InstalledMenuAction = 'github' | 'block' | 'unblock' | 'uninstall' | 'clear-data'

const state = ref<AppsState>()
const query = ref('')
const checking = ref(false)
const installing = ref('')
const removing = ref('')
const activeTab = ref<AppTab>('discover')
const catalogFailed = ref(false)
const matches = (item: { id: string; name: string; description?: string }) => `${item.id} ${item.name} ${item.description || ''}`.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())
function api() { const value = getPlatformApi()?.apps; if (!value) throw new Error('应用服务不可用'); return value }
function receive(next: AppsState) {
  state.value = next
  catalogFailed.value = Boolean(next.catalogError)
  applyPlatformSnapshot(next.snapshot)
  if (activeTab.value === 'debug' && !next.installed.some(item => item.test)) activeTab.value = 'discover'
}
const blockedIds = computed(() => new Set(state.value?.blocked || []))
const catalogApps = computed(() => !catalogFailed.value && !state.value?.catalog?.example ? state.value?.catalog?.apps || [] : [])
const localApp = (id: string) => state.value?.installed.find(item => item.id === id)
const releaseFor = (application?: CatalogApp) => application && compatibleAppRelease(application, shellVersion)
function cardFromCatalog(application: CatalogApp): AppCard {
  const local = localApp(application.id), release = releaseFor(application), restart = state.value?.pendingRestart.find(item => item.id === application.id)?.action
  return { id: application.id, name: application.name, description: local?.description || application.description, icon: local?.iconUrl || application.icon,
    version: local?.version || release?.version, sizeBytes: release?.package.sizeBytes ?? null, installed: Boolean(local) || restart === 'uninstall', test: Boolean(local?.test), blocked: blockedIds.value.has(application.id),
    hasUpdate: Boolean(local?.version && release && compareAppVersions(release.version, local.version) > 0), restart, release, repository: application.repository, updateError: local?.updateError }
}
function cardFromLocal(application: InstalledApp): AppCard {
  const catalog = catalogApps.value.find(item => item.id === application.id), release = releaseFor(catalog)
  return { id: application.id, name: application.name, description: application.description || catalog?.description, icon: application.iconUrl || catalog?.icon,
    version: application.version, sizeBytes: release?.package.sizeBytes ?? null, installed: true, test: application.test, blocked: blockedIds.value.has(application.id),
    hasUpdate: Boolean(application.version && release && compareAppVersions(release.version, application.version) > 0), restart: state.value?.pendingRestart.find(item => item.id === application.id)?.action, release, repository: catalog?.repository, updateError: application.updateError }
}
const discoveredCards = computed(() => catalogApps.value.map(cardFromCatalog).filter(item => !item.blocked && matches(item)))
const allInstalledCards = computed(() => {
  const local = (state.value?.installed || []).filter(item => !item.test).map(cardFromLocal)
  const localIds = new Set(local.map(item => item.id))
  const pendingUninstalls = catalogApps.value.filter(item => !localIds.has(item.id) && state.value?.pendingRestart.some(change => change.id === item.id && change.action === 'uninstall')).map(cardFromCatalog)
  return [...local, ...pendingUninstalls]
})
const installedCards = computed(() => allInstalledCards.value.filter(matches))
const allBlockedCards = computed(() => catalogApps.value.map(cardFromCatalog).filter(item => item.blocked))
const blockedCards = computed(() => allBlockedCards.value.filter(matches))
const allDebugCards = computed(() => (state.value?.installed || []).filter(item => item.test).map(cardFromLocal))
const debugCards = computed(() => allDebugCards.value.filter(matches))
const pendingRestartCount = computed(() => state.value?.pendingRestart.length || 0)
const tabs = computed(() => [
  { id: 'discover' as const, label: '发现' },
  { id: 'installed' as const, label: '已安装', count: allInstalledCards.value.length, hasUpdate: allInstalledCards.value.some(item => item.hasUpdate) },
  { id: 'blocked' as const, label: '已屏蔽', count: allBlockedCards.value.length },
  ...(allDebugCards.value.length ? [{ id: 'debug' as const, label: '调试' }] : []),
])
const visibleCards = computed(() => ({ discover: discoveredCards.value, installed: installedCards.value, blocked: blockedCards.value, debug: debugCards.value })[activeTab.value])
const emptyDescription = computed(() => checking.value && activeTab.value === 'discover' ? '正在加载…' : query.value ? '暂无匹配的应用' : ({ discover: '暂无可发现的应用', installed: '暂无已安装应用', blocked: '暂无已屏蔽应用', debug: '暂无调试应用' })[activeTab.value])
function sizeLabel(size: number | null) {
  if (!size) return '大小未知'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
async function refresh() {
  checking.value = true
  try { receive(await api().refreshCatalog()) }
  catch { catalogFailed.value = true }
  finally { checking.value = false }
}
async function install(card: AppCard) {
  if (!card.release || installing.value) return
  installing.value = card.id
  try { receive(await api().install(card.id)) }
  catch (error) {
    const message = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : '请稍后重试。'
    ElNotification.error({ title: '安装或更新失败', message })
  }
  finally { installing.value = '' }
}
async function uninstall(card: AppCard) {
  if (removing.value || card.restart === 'uninstall') return
  try { await ElMessageBox.confirm(`卸载「${card.name}」并删除应用文件？`, '卸载应用', { confirmButtonText: '卸载', cancelButtonText: '取消', type: 'warning' }) } catch { return }
  removing.value = card.id
  try { receive(await api().uninstall(card.id)) }
  catch { /* 待重启时由页面内提示说明，不显示不可关闭的浮层通知。 */ }
  finally { removing.value = '' }
}
async function restart() {
  try { await api().restart() }
  catch { ElNotification.error({ title: '重启失败', message: '请手动退出并重新打开 Mira。' }) }
}
function openRepository(repository?: string) {
  if (repository) window.open(repository, '_blank', 'noopener,noreferrer')
}
function handleInstalledMenu(card: AppCard, action: InstalledMenuAction) {
  if (action === 'github') openRepository(card.repository)
  else if (action === 'uninstall') void uninstall(card)
  else if (action === 'clear-data') void clearAppData(card.id)
  else void setBlocked(card.id, action === 'block')
}
async function clearAppData(id: string) {
  try { await getPlatformApi()?.clearAppData(id) }
  catch { ElNotification.error({ title: '清除数据失败', message: '请检查应用状态后重试。' }) }
}
async function setBlocked(id: string, blocked: boolean) {
  try { receive(await api().setBlocked(id, blocked)) }
  catch { ElNotification.error({ title: '更新失败', message: '请稍后重试。' }) }
}
async function openDirectory(id: string) {
  try { await api().openDirectory(id) }
  catch { ElNotification.error({ title: '打开目录失败', message: '请检查应用目录是否存在。' }) }
}
let removeAppsListener: (() => void) | undefined
onUnmounted(() => removeAppsListener?.())
onMounted(async () => {
  removeAppsListener = getPlatformApi()?.apps?.onChanged?.(receive)
  try { receive(await api().scan()) } catch { /* 扫描失败仍显示应用中心空状态。 */ }
  await refresh()
})
</script>

<style scoped>
.app-extensions { min-width: 0; container-type: inline-size; }
.app-extensions__header { display: flex; align-items: center; gap: 24px; margin-bottom: 24px; }
.app-extensions__header h1 { margin: 0; font-size: var(--settings-text-title); font-weight: 550; line-height: 1.333333; letter-spacing: -0.02em; }
.app-extensions__tools { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.app-extensions__search { display: flex; align-items: center; gap: 8px; width: 256px; padding: 8px 11px; border: 1px solid var(--cp-border-light); border-radius: 12px; background: var(--cp-bg); color: var(--cp-text-secondary); }
.app-extensions__search:focus-within { border-color: var(--cp-border); }
.app-extensions__search input { min-width: 0; width: 100%; border: 0; outline: none; background: none; color: var(--cp-text); font: inherit; font-size: 12px; }
.app-extensions__search :deep(.app-icon) { flex: none; width: 12px; height: 12px; margin: 0; }
.app-extensions button { border: 0; background: transparent; color: var(--cp-text); font: inherit; cursor: pointer; }
.app-extensions button:focus-visible { outline: 2px solid var(--cp-text-secondary); outline-offset: 2px; }
.app-extensions .app-extensions__refresh { display: grid; place-items: center; width: 32px; height: 32px; padding: 0; color: var(--cp-text-secondary); }
.app-extensions__refresh-icon { display: grid; place-items: center; }
.app-extensions__refresh-icon :deep(.app-icon) { margin: 0; }
.app-extensions__refresh-icon.is-spinning { animation: app-extensions-refresh 1s linear infinite; }
@keyframes app-extensions-refresh { to { transform: rotate(360deg); } }
.app-extensions__tabs { display: flex; align-items: center; gap: 4px; min-height: 40px; border-bottom: 1px solid var(--cp-border-light); }
.app-extensions__tabs button { position: relative; display: inline-flex; align-items: center; gap: 5px; height: 40px; padding: 0 12px; color: var(--cp-text-secondary); font-size: var(--settings-text-base); font-weight: 450; }
.app-extensions__tabs button::after { position: absolute; right: 12px; bottom: -1px; left: 12px; height: 2px; background: transparent; content: ''; }
.app-extensions__tabs button:hover { color: var(--cp-text); }
.app-extensions__tabs button.is-active { color: var(--cp-text); font-weight: 550; }
.app-extensions__tabs button.is-active::after { background: var(--cp-text); }
.app-extensions__tab-count { color: inherit; font-variant-numeric: tabular-nums; }
.app-extensions__tab-update { width: 6px; height: 6px; border-radius: 50%; background: var(--el-color-danger, #e5484d); }
.app-extensions__restart-notice { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 48px; margin-top: 16px; padding: 8px 12px 8px 14px; border: 1px solid var(--cp-border); border-radius: 8px; color: var(--cp-text); font-size: var(--settings-text-base); }
.app-extensions__restart-notice > span { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.app-extensions__restart-notice :deep(.app-icon) { margin: 0; color: var(--cp-text-secondary); }
.app-extensions__restart { flex: none; min-height: 28px; padding: 4px 10px !important; border: 1px solid var(--cp-border) !important; border-radius: 6px; background: var(--cp-bg) !important; font-size: var(--settings-text-small) !important; }
.app-extensions__restart:hover { background: var(--cp-bg-hover) !important; }
.app-extensions__panel { padding-top: 20px; }
.app-extensions__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.app-card { display: grid; grid-template-rows: auto auto minmax(48px, 1fr) auto; gap: 14px; min-width: 0; min-height: 214px; padding: 18px; border: 1px solid var(--cp-border); border-radius: 12px; background: transparent; }
.app-card__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.app-card__identity { display: flex; align-items: center; gap: 10px; min-width: 0; }
.app-card__icon { display: grid; place-items: center; flex: 0 0 32px; width: 32px; height: 32px; overflow: hidden; border-radius: 8px; background: var(--cp-bg); color: var(--cp-text-secondary); }
.app-card__icon img { width: 100%; height: 100%; object-fit: contain; }
.app-card__identity h2 { display: flex; align-items: center; gap: 6px; min-width: 0; margin: 0; overflow: hidden; font-size: var(--settings-text-base); font-weight: 550; line-height: 20px; text-overflow: ellipsis; white-space: nowrap; }
.app-card__action { flex: none; min-width: 58px; min-height: 28px; padding: 4px 10px; border: 1px solid var(--cp-border) !important; border-radius: 6px; background: var(--cp-bg) !important; font-size: var(--settings-text-small); }
.app-card__action:hover:not(:disabled) { background: var(--cp-bg-hover) !important; }
.app-card__action:disabled { opacity: .6; cursor: default; }
.app-card__installed, .app-card__unavailable { display: inline-flex; align-items: center; gap: 3px; min-height: 28px; color: var(--el-color-success, #30a46c); font-size: var(--settings-text-small); font-weight: 500; white-space: nowrap; }
.app-card__unavailable { color: var(--cp-text-secondary); font-weight: 400; }
.app-card__meta { display: flex; flex-wrap: wrap; gap: 6px; }
.app-card__meta span { display: inline-flex; align-items: center; gap: 4px; padding: 3px 7px; border: 1px solid var(--cp-border-light); border-radius: 999px; color: var(--cp-text-secondary); font-size: var(--settings-text-small); line-height: 16px; }
.app-card__meta :deep(.app-icon) { margin: 0; }
.app-card__description { display: -webkit-box; margin: 0; overflow: hidden; color: var(--cp-text-secondary); font-size: var(--settings-text-small); line-height: 22px; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
.app-card__footer { display: flex; align-items: center; justify-content: space-between; min-height: 24px; }
.app-card__status { display: inline-flex; align-items: center; gap: 4px; min-height: 28px; color: var(--cp-text-secondary); font-size: var(--settings-text-small); }
.app-card__status.is-restart { padding: 4px 8px; border-radius: 5px; background: var(--el-color-success-light-9, #edf9f1); color: var(--el-color-success, #30a46c); }
.app-card__more { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border-radius: 5px; color: var(--cp-text-secondary); }
.app-card__more:hover { background: var(--cp-bg); color: var(--cp-text); }
:global(.app-extensions-menu .el-dropdown-menu__item) { min-width: 96px; font-size: var(--settings-text-small); }
:global(.app-extensions-menu .el-dropdown-menu__item.is-danger) { color: var(--el-color-danger, #e5484d); }
@container (min-width: 980px) { .app-extensions__grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@container (max-width: 620px) { .app-extensions__grid { grid-template-columns: minmax(0, 1fr); } }
</style>
