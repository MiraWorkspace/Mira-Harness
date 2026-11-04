<template>
  <SettingsPageShell title="应用扩展" :show-title="false">
    <div class="app-extensions">
      <header class="app-extensions__header">
        <h1>应用扩展</h1>
        <label class="app-extensions__search"><AppIcon name="lucide:search" aria-hidden="true" /><input v-model="query" type="search" placeholder="搜索应用…" aria-label="搜索应用" /></label>
      </header>
      <section v-if="debugApps.length" aria-labelledby="debug-apps-heading">
        <div class="app-extensions__heading"><h2 id="debug-apps-heading">调试列表 <small>{{ debugApps.length }}</small></h2></div>
        <div v-if="filteredDebugApps.length" class="app-extensions__list">
          <article v-for="application in filteredDebugApps" :key="application.id" class="app-extension">
            <span class="app-extension__icon"><img v-if="application.iconUrl" :src="application.iconUrl" alt="" /><AppIcon v-else name="lucide:app-window" :size="22" aria-hidden="true" /></span>
            <div class="app-extension__copy"><h3>{{ application.name }} <DevBadge /></h3><p v-if="application.description">{{ application.description }}</p><small v-if="application.version">v{{ application.version }}</small></div>
            <div class="app-extension__actions"><button type="button" :disabled="busy" :aria-label="`打开 ${application.name} 目录`" @click="openDirectory(application.id)">打开目录</button></div>
          </article>
        </div>
        <el-empty v-else description="暂无匹配的应用" :image-size="72" />
      </section>
      <section aria-labelledby="official-apps-heading">
        <div class="app-extensions__heading"><h2 id="official-apps-heading">官方应用 <small>{{ official.length }}</small></h2><button type="button" :disabled="busy" @click="refresh">{{ checking ? '检查中…' : '检查更新' }}</button></div>
        <div v-if="official.length" class="app-extensions__list">
          <article v-for="application in official" :key="application.id" class="app-extension">
            <span class="app-extension__icon"><img v-if="application.icon" :src="application.icon" alt="" /><AppIcon v-else name="lucide:app-window" :size="22" aria-hidden="true" /></span>
            <div class="app-extension__copy"><h3>{{ application.name }}</h3><p>{{ application.description }}</p><small v-if="appVersion(application)">v{{ appVersion(application) }}</small></div>
            <div class="app-extension__actions">
              <button v-if="restartAction(application.id)" type="button" :disabled="busy" :aria-label="`重启 Mira · ${application.name}`" @click="restart(application)">重启</button>
              <button v-else-if="localApp(application.id)" type="button" :disabled="busy" :aria-label="`卸载 ${application.name}`" @click="uninstall(application)">{{ removing === application.id ? '卸载中…' : '卸载' }}</button>
              <button v-else type="button" :disabled="busy || !compatibleAppRelease(application, shellVersion)" :aria-label="`安装 ${application.name}`" @click="install(application)">{{ installing === application.id ? '安装中…' : '安装' }}</button>
            </div>
          </article>
        </div>
        <el-empty v-else :description="checking ? '正在加载…' : query ? '暂无匹配的应用' : '暂无应用'" :image-size="72" />
      </section>
    </div>
  </SettingsPageShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessageBox, ElNotification } from 'element-plus'
import { useRoute, useRouter } from 'vue-router'
import SettingsPageShell from '../settings/components/SettingsPageShell.vue'
import DevBadge from '@/components/DevBadge.vue'
import { getPlatformApi } from '@/platform'
import { applyPlatformSnapshot } from '@/config/runtime'
import { HARNESS_WORKBENCH_PATH } from '@/platform/firstPartyNavigation'
import { compatibleAppRelease, type AppsState, type CatalogApp } from '@/config/miraApps'
import { version as shellVersion } from '../../../../package.json'

const router = useRouter()
const route = useRoute()
const state = ref<AppsState>()
const query = ref('')
const busy = ref(false)
const checking = ref(false)
const catalogFailed = ref(false)
const installing = ref('')
const removing = ref('')
const matches = (item: { id: string; name: string; description?: string }) => `${item.id} ${item.name} ${item.description || ''}`.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())
const debugApps = computed(() => state.value?.installed.filter(item => item.test) || [])
const filteredDebugApps = computed(() => debugApps.value.filter(matches))
const official = computed(() => !catalogFailed.value && !state.value?.catalog?.example ? (state.value?.catalog?.apps || []).filter(matches) : [])
function api() { const value = getPlatformApi()?.apps; if (!value) throw new Error('应用服务不可用'); return value }
function receive(next: AppsState) { state.value = next; applyPlatformSnapshot(next.snapshot) }
function localApp(id: string) { return state.value?.installed.find(item => item.id === id && !item.test) }
function restartAction(id: string) { return state.value?.pendingRestart.find(item => item.id === id)?.action }
function appVersion(application: CatalogApp) { return localApp(application.id)?.version || compatibleAppRelease(application, shellVersion)?.version }
async function refresh() {
  if (busy.value) return
  busy.value = true; checking.value = true
  try {
    const next = await api().refreshCatalog()
    receive(next); catalogFailed.value = Boolean(next.catalogError)
  } catch { catalogFailed.value = true }
  finally { busy.value = false; checking.value = false }
}
async function install(application: CatalogApp) {
  if (busy.value) return
  busy.value = true; installing.value = application.id
  try { receive(await api().install(application.id)) }
  catch { ElNotification.error({ title: '安装失败', message: '请检查网络连接后重试。' }) }
  finally { busy.value = false; installing.value = '' }
}
async function uninstall(application: CatalogApp) {
  if (busy.value) return
  try { await ElMessageBox.confirm(`卸载「${application.name}」并删除应用文件？`, '卸载应用', { confirmButtonText: '卸载', cancelButtonText: '取消', type: 'warning' }) } catch { return }
  if (busy.value) return
  busy.value = true; removing.value = application.id
  try {
    receive(await api().uninstall(application.id))
    const from = typeof route.query.from === 'string' ? route.query.from.split(/[?#]/)[0] : ''
    if (from === `/micro/${application.id}` || from.startsWith(`/micro/${application.id}/`)) {
      await router.replace({ path: route.path, query: { ...route.query, from: HARNESS_WORKBENCH_PATH } })
    }
  } catch { ElNotification.error({ title: '卸载失败', message: '请稍后重试。' }) }
  finally { busy.value = false; removing.value = '' }
}
async function restart(application: CatalogApp) {
  if (busy.value) return
  const installed = restartAction(application.id) === 'install'
  const message = installed ? `安装已完成。重启 Mira 后即可使用「${application.name}」。` : '卸载已完成。建议重启 Mira，完成应用资源清理。'
  try { await ElMessageBox.confirm(message, '重启 Mira', { confirmButtonText: '立即重启', cancelButtonText: '稍后' }) } catch { return }
  busy.value = true
  try { await api().restart() }
  catch { ElNotification.error({ title: '重启失败', message: '请手动退出并重新打开 Mira。' }) }
  finally { busy.value = false }
}
async function openDirectory(id: string) {
  try { await api().openDirectory(id) }
  catch { ElNotification.error({ title: '打开目录失败', message: '请检查应用目录是否存在。' }) }
}
onMounted(async () => {
  busy.value = true
  try { receive(await api().scan()) } catch { /* 扫描失败仍显示官方列表缺省状态。 */ }
  finally { busy.value = false }
  await refresh()
})
</script>

<style scoped>

.app-extensions { min-width: 0; }
.app-extensions__header { display: flex; align-items: center; gap: 24px; margin-bottom: 24px; }
.app-extensions__header h1 { margin: 0; font-size: var(--settings-text-title); font-weight: 550; line-height: 1.333333; letter-spacing: -0.02em; }
.app-extensions small { color: var(--cp-text-secondary); font-size: var(--settings-text-small); font-weight: 400; }
.app-extensions__search { display: flex; align-items: center; gap: 8px; width: 256px; margin-left: auto; padding: 8px 11px; border: 1px solid var(--cp-border-light); border-radius: 12px; background: var(--cp-bg); color: var(--cp-text-secondary); }
.app-extensions__search:focus-within { border-color: var(--cp-border); }
.app-extensions__search input { min-width: 0; width: 100%; border: 0; outline: none; background: none; color: var(--cp-text); font: inherit; font-size: 12px; }
.app-extensions__search :deep(.app-icon) { flex: none; width: 12px; height: 12px; margin: 0; }
.app-extensions__heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.app-extensions__heading h2 { display: flex; align-items: center; gap: 8px; margin: 0; font-size: var(--settings-text-base); font-weight: 450; }
.app-extensions__list { overflow: hidden; padding: 0 20px; border: 1px solid var(--cp-border); border-radius: 14px; }
.app-extension { display: flex; align-items: center; gap: 16px; padding: 20px 0; }
.app-extension + .app-extension { border-top: 1px solid var(--cp-border-light); }
.app-extension__icon { display: grid; place-items: center; flex: 0 0 40px; height: 40px; border-radius: 12px; background: var(--cp-bg); color: var(--cp-text); }
.app-extension__copy { display: grid; flex: 1; gap: 4px; min-width: 0; }
.app-extension__copy h3 { margin: 0; font-size: var(--settings-text-base); font-weight: 450; line-height: 20px; }
.app-extension__copy p { margin: 0; color: var(--cp-text-secondary); line-height: 24px; overflow-wrap: anywhere; }

.app-extensions button { padding: 6px 12px; border: 1px solid var(--cp-border); border-radius: 6px; background: var(--cp-bg); color: var(--cp-text); font: inherit; font-size: var(--settings-text-small); cursor: pointer; }
.app-extensions button:hover:not(:disabled) { background: var(--cp-bg-hover); }
.app-extensions button:disabled { opacity: .5; cursor: default; }
.app-extensions button:focus-visible { outline: 2px solid var(--cp-text-secondary); outline-offset: 2px; }
.app-extensions section + section { margin-top: 32px; }
.app-extension__copy h3 { display: flex; align-items: center; gap: 8px; overflow-wrap: anywhere; }
.app-extension__copy > small { color: var(--cp-text-secondary); font-size: var(--settings-text-small); }
.app-extension__actions { display: flex; align-items: center; flex-shrink: 0; gap: 8px; }
.app-extension__icon img { width: 32px; height: 32px; object-fit: contain; }
</style>
