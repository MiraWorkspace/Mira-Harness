<template>
  <main class="resource-manager" data-testid="resource-manager">
    <header class="resource-header" :class="{ 'resource-header--windows': bridge.isWindows }">
      <div class="resource-heading"><h1>资源管理器</h1><div v-if="usageActive" class="subtle tiny">{{ snapshot ? `${snapshot.processes.length} 个进程 · ${snapshot.plugins?.length ?? 0} 个插件` : '正在读取资源占用...' }}</div></div>
      <div role="tablist" aria-label="资源类型" class="resource-tabs">
        <button v-for="item in tabs" :id="`tab-${item.id}`" :key="item.id" role="tab" :aria-selected="tab === item.id" :tabindex="tab === item.id ? 0 : -1" aria-controls="resource-content" @click="tab = item.id" @keydown="moveTab($event, item.id)">{{ item.label }}</button>
      </div>
      <div v-if="bridge.isWindows" class="resource-window-controls" aria-label="窗口控制">
        <button type="button" title="最小化" aria-label="最小化" @click="bridge.windowCommand('minimize')"><Minus :size="14" /></button>
        <button type="button" :title="maximized ? '还原' : '最大化'" :aria-label="maximized ? '还原' : '最大化'" @click="bridge.windowCommand('maximize')"><Copy v-if="maximized" :size="13" /><Square v-else :size="12" /></button>
        <button type="button" class="resource-window-close" title="关闭" aria-label="关闭" @click="bridge.windowCommand('close')"><X :size="14" /></button>
      </div>
    </header>
    <div id="resource-content" role="tabpanel" :aria-labelledby="`tab-${tab}`" class="resource-content">
      <template v-if="usageActive">
        <p v-if="error" role="alert" class="error card">{{ error }}</p>
        <p v-if="snapshot?.warning" role="status" class="sampling-note small subtle">{{ snapshot.warning }}</p>
        <div class="usage-layout">
          <aside>
            <div class="card usage-meter" :data-testid="`resource-manager-${tab}`">
              <div class="subtle small medium">{{ tab === 'cpu' ? 'CPU' : '内存' }}</div>
              <div class="meter-value"><span class="mono">{{ snapshot ? (tab === 'cpu' ? formatPercent(appCpu) : formatBytes(appMemory)) : '—' }}</span><span class="tiny muted">Mira</span></div>
              <div class="meter-bar" role="img" :aria-label="`Mira ${appValue}，整机 ${systemValue}`"><div class="meter-system" :style="{ width: `${systemUsage}%` }" /><div class="meter-app" :style="{ width: `${appUsage}%` }" /></div>
              <div class="meter-legend tiny subtle"><span><i class="app-dot" />Mira</span><span><i class="system-dot" />整机 <b class="mono">{{ systemValue }}</b></span></div>
              <p class="usage-note small subtle">包含 Mira 及其子进程，每秒刷新。共享进程只计一次；插件的启用状态不代表正在执行。</p>
              <p v-if="groups.some(group => group.pendingCpu) && tab === 'cpu'" class="usage-note small subtle">新发现的子进程将在下一次采样后显示 CPU；当前合计为已采样部分。</p>
            </div>
          </aside>
          <section class="usage-groups">
            <div v-for="group in groups" :key="group.id" class="card usage-group" :data-testid="`resource-manager-group-${group.id}`">
              <button class="group-heading" :aria-expanded="expanded[group.id]" @click="expanded[group.id] = !expanded[group.id]"><ChevronRight :size="16" class="subtle chevron" :class="{ expanded: expanded[group.id] }" /><span class="group-title">{{ group.title }}</span><span class="group-count tiny subtle">{{ group.plugins.length ? `${group.plugins.length} 个插件 · ` : '' }}{{ group.processes.length }} 个进程</span><span class="group-total mono small subtle">{{ group.processes.length ? (tab === 'cpu' ? formatPercent(group.cpuPercent) : formatBytes(group.memoryBytes)) : '—' }}</span></button>
              <div v-if="expanded[group.id]" class="group-body">
                <div v-if="!group.processes.length && !group.plugins.length" class="empty small subtle">{{ snapshot ? group.empty : '正在读取...' }}</div>
                <div v-for="plugin in group.plugins" :key="plugin.id" class="plugin-row small" data-testid="resource-manager-plugin-row">
                  <div class="plugin-identity"><span class="medium">{{ plugin.name }}</span><span class="resource-status tiny">{{ plugin.status }}</span></div>
                  <p class="process-detail subtle">{{ plugin.detail }}</p>
                  <p v-if="plugin.pids.length" class="process-detail subtle">{{ plugin.pids.length }} 个独立进程，占用明细见下方</p>
                </div>
                <template v-if="group.processes.length"><div class="process-grid process-heading tiny subtle"><div>进程 / 用途</div><div>PID</div><div>{{ tab === 'cpu' ? 'CPU' : '内存' }}</div></div>
                  <div v-for="row in group.processes" :key="row.pid" class="process-grid process-row small" data-testid="resource-manager-process-row">
                    <div class="process-identity"><div class="view-identity"><div class="process-name medium" :title="row.name">{{ row.name }}</div><span v-if="row.views?.length === 1" class="resource-status tiny">{{ row.views[0].status }}</span></div><p v-if="row.detail" class="process-detail subtle">{{ row.detail }}</p>
                      <p v-if="row.views?.length === 1 && row.views[0].detail" class="process-detail subtle">{{ row.views[0].detail }}</p>
                      <div v-for="view in (row.views?.length ?? 0) > 1 ? row.views : []" :key="view.id" class="resource-view"><div class="view-identity"><span class="medium">{{ view.name }}</span><span class="resource-status tiny">{{ view.status }}</span></div><p v-if="view.detail" class="process-detail subtle">{{ view.detail }}</p></div>
                    </div><div class="mono subtle">{{ row.pid }}</div><div class="mono subtle">{{ tab === 'cpu' ? formatPercent(row.cpuPercent) : formatBytes(row.memoryBytes) }}</div>
                  </div>
                </template>
              </div>
            </div>
          </section>
        </div>
      </template>
      <StorageSection v-else-if="tab === 'storage'" :bridge="bridge.storage" />
      <NetworkSection v-else :bridge="bridge.network" />
    </div>
  </main>
</template>
<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { ChevronRight, Copy, Minus, Square, X } from 'lucide-vue-next'
import type { MiraResourceBridge, MiraResourceSnapshot } from '../config/resourceManager'
import { clampPercent, formatBytes, formatPercent, groupResourceUsage } from './resourceUsageView'
import StorageSection from './StorageSection.vue'
import NetworkSection from './NetworkSection.vue'
import './resource-manager.css'
const bridge = (window as unknown as { resourceManager: MiraResourceBridge }).resourceManager
const maximized = ref(false)
const stopMaximized = bridge.isWindows ? bridge.onMaximized(value => { maximized.value = value }) : undefined
if (bridge.isWindows) void bridge.windowCommand('state').then(value => { maximized.value = value })
onUnmounted(() => stopMaximized?.())
const tabs = [{ id: 'cpu', label: 'CPU' }, { id: 'memory', label: '内存' }, { id: 'storage', label: '存储' }, { id: 'network', label: '网络' }] as const
type Tab = typeof tabs[number]['id']
const tab = ref<Tab>('cpu')
const snapshot = ref<MiraResourceSnapshot>()
const error = ref('')
const expanded = ref({ ui: true, base: true, 'builtin-plugin': true, 'community-plugin': true, other: true })
const usageActive = computed(() => tab.value === 'cpu' || tab.value === 'memory')
const groups = computed(() => groupResourceUsage(snapshot.value?.processes ?? [], snapshot.value?.plugins ?? [], tab.value === 'memory' ? 'memory' : 'cpu'))
const appCpu = computed(() => groups.value.reduce((sum, group) => sum + group.cpuPercent, 0))
const appMemory = computed(() => groups.value.reduce((sum, group) => sum + group.memoryBytes, 0))
const appValue = computed(() => tab.value === 'cpu' ? formatPercent(snapshot.value ? appCpu.value : undefined) : formatBytes(snapshot.value ? appMemory.value : undefined))
const systemValue = computed(() => tab.value === 'cpu' ? formatPercent(snapshot.value?.system.cpuPercent) : snapshot.value ? `${formatBytes(snapshot.value.system.memoryUsedBytes)} / ${formatBytes(snapshot.value.system.memoryTotalBytes)}` : '—')
const systemUsage = computed(() => { const system = snapshot.value?.system; return system ? clampPercent(tab.value === 'cpu' ? system.cpuPercent ?? 0 : system.memoryUsedBytes / system.memoryTotalBytes * 100) : 0 })
const appUsage = computed(() => snapshot.value ? clampPercent(tab.value === 'cpu' ? appCpu.value : appMemory.value / snapshot.value.system.memoryTotalBytes * 100) : 0)
let stopPolling = () => {}
watch(usageActive, active => {
  stopPolling()
  if (!active) return
  let disposed = false, timer: ReturnType<typeof setTimeout> | undefined
  stopPolling = () => { disposed = true; clearTimeout(timer) }
  async function refresh() {
    try { const next = await bridge.getSnapshot(); if (!disposed) { snapshot.value = next; error.value = '' } }
    catch { if (!disposed) error.value = '资源管理器接口不可用' }
    if (!disposed) timer = setTimeout(refresh, 1000)
  }
  void refresh()
}, { immediate: true })
onUnmounted(() => stopPolling())
function moveTab(event: KeyboardEvent, current: Tab) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const index = tabs.findIndex(item => item.id === current)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
  tab.value = tabs[next].id
  document.getElementById(`tab-${tab.value}`)?.focus()
}
</script>
