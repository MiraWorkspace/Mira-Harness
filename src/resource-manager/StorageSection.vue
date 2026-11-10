<template>
  <section class="storage-workstation" :aria-busy="scanning || !!cleaning">
    <header class="storage-heading">
      <div><h2>本地存储</h2><p>看清 Mira 与每个子应用的数据，让本地空间始终有数。</p></div>
      <button class="action" :disabled="scanning || !!cleaning" @click="scan"><RefreshCw :size="14" :class="{ 'storage-spinning': scanning }" />{{ scanning ? '正在扫描…' : '重新扫描' }}</button>
    </header>
    <p v-if="error" class="storage-notice storage-failure" role="alert">{{ error }}</p>
    <p v-if="message" class="storage-notice" role="status">{{ message }}</p>
    <template v-if="snapshot">
      <div class="storage-dashboard">
        <div class="storage-footprint">
          <div class="storage-panel-title"><Database :size="16" /><h3>Mira 与子应用</h3><span class="caption subtle">{{ owners.size }} 个应用与浏览分区</span></div>
          <div class="storage-measure"><strong>已占用 {{ formatBytes(snapshot.totalBytes) }}</strong></div>
          <p v-if="snapshot.volume" class="storage-disk-share">约占整块磁盘 {{ diskMiraPercent.toFixed(2) }}%</p>
          <div class="storage-comparison-heading caption">Mira 数据用途排行</div>
          <div class="storage-comparison" aria-label="Mira 数据用途排行"><button v-for="item in composition" :key="item.id" :aria-pressed="purpose === item.id" :aria-label="`${item.title} ${formatBytes(item.bytes)}，占 Mira 数据 ${snapshot.totalBytes ? (item.bytes / snapshot.totalBytes * 100).toFixed(1) : 0}%`" @click="purpose = purpose === item.id ? '' : item.id; view = 'purpose'"><span>{{ item.title }}</span><span class="storage-comparison-bar" aria-hidden="true"><i :style="{ width: `${composition[0]?.bytes ? item.bytes / composition[0].bytes * 100 : 0}%`, background: item.color }" /></span><b>{{ formatBytes(item.bytes) }}</b></button></div>
        </div>
        <div class="storage-volume">
          <div class="storage-panel-title"><HardDrive :size="16" /><h3>整块磁盘</h3><span class="storage-disk-status">{{ diskPressure }}</span></div>
          <template v-if="snapshot.volume"><div class="storage-measure storage-free"><strong>剩余可用 {{ formatBytes(snapshot.volume.freeBytes) }}</strong></div>
            <p class="storage-disk-capacity caption">磁盘总容量 {{ formatBytes(snapshot.volume.totalBytes) }}</p>
            <div class="storage-volume-bar" role="img" :aria-label="`整块磁盘容量分布：Mira 数据约占 ${diskMiraPercent.toFixed(2)}%，系统及其余文件约占 ${(diskUsedPercent - diskMiraPercent).toFixed(2)}%，剩余可用 ${(100 - diskUsedPercent).toFixed(2)}%`"><i class="storage-volume-mira" :style="{ width: `${diskMiraPercent}%` }" /><i class="storage-volume-used" :style="{ width: `${diskUsedPercent - diskMiraPercent}%` }" /><i class="storage-volume-free" :style="{ width: `${100 - diskUsedPercent}%` }" /></div>
            <dl class="storage-volume-legend"><div><dt><i class="storage-volume-mira" />Mira 与子应用数据</dt><dd>约 {{ formatBytes(snapshot.totalBytes) }}</dd></div><div><dt><i class="storage-volume-used" />系统及其余文件</dt><dd>约 {{ formatBytes(diskOtherBytes) }}</dd></div><div class="storage-volume-available"><dt><i class="storage-volume-free" />磁盘剩余可用</dt><dd>{{ formatBytes(snapshot.volume.freeBytes) }}</dd></div></dl>
          </template><p v-else class="storage-volume-unknown">无法读取磁盘容量，Mira 数据统计仍可查看。</p>

        </div>
      </div>
      <div class="storage-reclaim"><Eraser :size="19" /><div><strong>约 {{ formatBytes(reclaimable) }} 网页与代码缓存可清理</strong><p>保留登录状态、会话和业务数据；缓存会在使用时重新生成。</p></div><button class="action" :disabled="!reclaimable || !!cleaning || scanning" @click="showCleanable">查看清理项目<ArrowDown :size="14" /></button></div>
      <p v-if="snapshot.errors" class="storage-notice" role="status">{{ snapshot.errors }} 个目录无法读取，统计可能不完整。请检查目录权限后重新扫描。</p>
      <section ref="listSection" class="storage-breakdown" aria-label="存储明细">
        <div class="storage-list-toolbar"><div class="storage-view-switch" aria-label="明细分组"><button :aria-pressed="view === 'owner'" @click="view = 'owner'; purpose = ''">按应用</button><button :aria-pressed="view === 'purpose'" @click="view = 'purpose'">按用途</button></div><label class="storage-search"><Search :size="14" /><input v-model="query" aria-label="搜索存储明细" placeholder="搜索应用、文件或路径" type="search" /></label><label class="storage-clean-filter"><input v-model="cleanableOnly" type="checkbox" />仅可清缓存</label></div>
        <div v-if="purpose" class="storage-active-filter caption">筛选：{{ purposeInfo[purpose]?.title }}<button class="action" @click="purpose = ''">取消筛选</button></div>
        <div class="storage-table-heading caption subtle"><span>{{ view === 'owner' ? '应用 / 浏览分区' : '数据用途' }}</span><span>占用空间</span><span>可清缓存</span><span /></div>
        <div v-for="group in groups" :key="group.id" class="storage-group">
          <button class="storage-group-button" :aria-expanded="expanded.has(group.id)" @click="toggle(group.id)"><span class="storage-group-name"><component :is="view === 'owner' ? AppWindow : Folder" :size="17" /><span><strong>{{ group.name }}</strong><small>{{ group.entries.length }} 项 · {{ group.files.toLocaleString() }} 个文件</small></span></span><span class="storage-group-size"><b>{{ formatBytes(group.bytes) }}</b><span class="storage-rank-bar"><i :style="{ width: `${maxGroupBytes ? group.bytes / maxGroupBytes * 100 : 0}%` }" /></span></span><span class="storage-cache-value">{{ group.cacheBytes ? formatBytes(group.cacheBytes) : '—' }}</span><ChevronRight :size="16" class="chevron" :class="{ expanded: expanded.has(group.id) }" /></button>
          <div v-if="expanded.has(group.id)" class="storage-group-detail">
            <div v-for="entry in group.entries" :key="entry.path" class="storage-file-row"><FileText :size="15" class="subtle" /><div><strong>{{ entry.name }}</strong><p class="caption subtle">{{ entry.categoryTitle }}<template v-if="entry.detail"> · {{ entry.detail }}</template></p><p class="storage-file-path mono" :title="entry.path">{{ entry.path }}</p></div><span class="storage-file-size">{{ formatBytes(entry.bytes) }}</span><button class="storage-reveal action" :aria-label="`显示 ${entry.name} 的文件位置`" title="在文件管理器中显示" @click="reveal(entry.path)"><FolderOpen :size="14" /></button></div>
            <div v-for="action in group.actions" :key="action.id" class="storage-cleanup-row"><div><strong>{{ action.title }}</strong><p>{{ action.description }}</p></div><button class="action" :class="{ 'storage-destructive': action.kind !== 'cache' }" :disabled="!!cleaning || scanning || !managementReady" @click="clean(action)"><component :is="action.kind === 'cache' ? Eraser : Trash2" :size="14" />{{ cleaning === action.id ? '正在处理…' : action.kind === 'cache' ? '清理缓存' : action.kind === 'database' ? '清除数据库' : '清除站点数据' }}</button></div>
          </div>
        </div>
        <p v-if="!groups.length" class="storage-no-results">{{ query || cleanableOnly || purpose ? '没有符合筛选条件的存储项目。可调整搜索或取消筛选。' : '数据目录暂无文件。开始使用 Mira 后，可在这里查看数据归属与占用。' }}</p>
      </section>
      <footer class="storage-footer"><div><Folder :size="14" /><span class="mono">{{ snapshot.root }}</span></div><p>统计 Mira 与子应用的数据目录，不包含应用程序本体、外部项目及授权目录中的文件。文件逻辑大小可能与磁盘实际占用不同。</p><span>上次扫描 {{ new Date(snapshot.finishedAt).toLocaleString() }}</span></footer>
    </template>
    <div v-else class="storage-initial" role="status"><HardDrive :size="28" /><strong>{{ scanning ? '正在扫描本地数据…' : '尚未取得存储统计' }}</strong><p>{{ scanning ? '正在核对 Mira、子应用及各浏览分区，文件较多时可能需要一些时间。' : '请点击重新扫描，再查看存储构成和清理项目。' }}</p></div>
  </section>
</template>
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { AppWindow, ArrowDown, ChevronRight, Database, Eraser, FileText, Folder, FolderOpen, HardDrive, RefreshCw, Search, Trash2 } from 'lucide-vue-next'
import type { MiraResourceBridge, MiraStorageAction, MiraStorageSnapshot } from '../config/resourceManager'
import { formatBytes } from './resourceUsageView'
const props = defineProps<{ bridge: MiraResourceBridge['storage'] }>()
const managementReady = ref(false)
const snapshot = ref<MiraStorageSnapshot>(), scanning = ref(false), cleaning = ref(''), error = ref(''), message = ref('')
const view = ref<'owner' | 'purpose'>('owner'), purpose = ref(''), query = ref(''), cleanableOnly = ref(false), expanded = ref(new Set<string>()), listSection = ref<HTMLElement>()
const purposeInfo: Record<string, { title: string; color: string }> = {
  apps: { title: '安装文件', color: 'var(--storage-install)' }, 'app-data': { title: '业务数据', color: 'var(--storage-data)' },
  content: { title: '会话与产物', color: 'var(--storage-content)' }, web: { title: '浏览分区与网页存储', color: 'var(--storage-web)' },
  cache: { title: 'Mira 界面缓存', color: 'var(--storage-cache)' }, system: { title: '配置、日志与运行文件', color: 'var(--storage-system)' }, other: { title: '待识别文件', color: 'var(--storage-unknown)' },
}
const purposeOf = (category: string) => ['apps', 'app-data', 'cache', 'other'].includes(category) ? category : ['sessions', 'artifacts'].includes(category) ? 'content' : ['partitions', 'site-data'].includes(category) ? 'web' : 'system'
const entries = computed(() => (snapshot.value?.categories ?? []).flatMap(category => category.entries.filter(entry => entry.bytes > 0 || entry.files > 0).map(entry => ({ ...entry, ownerId: entry.ownerId ?? 'mira', ownerName: entry.ownerName ?? 'Mira', cacheBytes: entry.cacheBytes ?? 0, category: category.id, categoryTitle: category.title, purpose: purposeOf(category.id) }))))
const owners = computed(() => new Set(entries.value.map(entry => entry.ownerId)))
const composition = computed(() => Object.entries(purposeInfo).map(([id, info]) => ({ id, ...info, bytes: entries.value.filter(entry => entry.purpose === id).reduce((sum, entry) => sum + entry.bytes, 0) })).filter(item => item.bytes > 0).sort((a, b) => b.bytes - a.bytes))
const reclaimable = computed(() => (snapshot.value?.actions ?? []).filter(action => action.kind === 'cache').reduce((sum, action) => sum + action.bytes, 0))
const diskUsedPercent = computed(() => { const volume = snapshot.value?.volume; return volume?.totalBytes ? Math.max(0, Math.min(100, (1 - volume.freeBytes / volume.totalBytes) * 100)) : 0 })
const diskMiraPercent = computed(() => { const volume = snapshot.value?.volume; return volume?.totalBytes ? Math.min(diskUsedPercent.value, Math.max(0, (snapshot.value?.totalBytes ?? 0) / volume.totalBytes * 100)) : 0 })
const diskOtherBytes = computed(() => { const volume = snapshot.value?.volume; return volume ? Math.max(0, volume.totalBytes - volume.freeBytes - (snapshot.value?.totalBytes ?? 0)) : 0 })
const diskPressure = computed(() => !snapshot.value?.volume ? '容量未知' : diskUsedPercent.value >= 90 ? '空间紧张' : diskUsedPercent.value >= 75 ? '留意空间' : '空间充足')
const groups = computed(() => {
  const matching = entries.value.filter(entry => (!purpose.value || entry.purpose === purpose.value) && (!cleanableOnly.value || entry.cacheBytes > 0) && `${entry.ownerName} ${entry.name} ${entry.path} ${entry.categoryTitle}`.toLowerCase().includes(query.value.trim().toLowerCase()))
  const map = new Map<string, { id: string; name: string; bytes: number; files: number; cacheBytes: number; entries: typeof matching; actions: MiraStorageAction[] }>()
  for (const entry of matching) {
    const id = view.value === 'owner' ? entry.ownerId : entry.purpose
    if (!map.has(id)) map.set(id, { id, name: view.value === 'owner' ? entry.ownerName : purposeInfo[id].title, bytes: 0, files: 0, cacheBytes: 0, entries: [], actions: [] })
    const group = map.get(id)!; group.bytes += entry.bytes; group.files += entry.files; group.cacheBytes += entry.cacheBytes; group.entries.push(entry)
  }
  for (const group of map.values()) {
    group.entries.sort((a, b) => b.bytes - a.bytes)
    // Management actions are scoped to the complete application; purpose/search filters show file locations only.
    if (view.value === 'owner' && !query.value && !purpose.value) group.actions = (snapshot.value?.actions ?? []).filter(action => action.ownerId === group.id && (!cleanableOnly.value || action.kind === 'cache'))
  }
  return [...map.values()].sort((a, b) => b.bytes - a.bytes)
})
const maxGroupBytes = computed(() => Math.max(0, ...groups.value.map(group => group.bytes)))
function toggle(id: string) { const next = new Set(expanded.value); next.has(id) ? next.delete(id) : next.add(id); expanded.value = next }
function showCleanable() { view.value = 'owner'; query.value = ''; purpose.value = ''; cleanableOnly.value = true; expanded.value = new Set(entries.value.filter(entry => entry.cacheBytes > 0).map(entry => entry.ownerId)); listSection.value?.scrollIntoView({ block: 'start', behavior: 'instant' }) }
let disposed = false
async function scan() {
  if (scanning.value || cleaning.value) return
  scanning.value = true; managementReady.value = false; error.value = ''
  try { const next = await props.bridge.scan(); if (!disposed) { snapshot.value = next; managementReady.value = true } }
  catch { if (!disposed) error.value = '扫描失败，请重新扫描。现有统计保留供参考。' }
  finally { if (!disposed) scanning.value = false }
}
async function clean(action: MiraStorageAction) {
  if (cleaning.value || scanning.value || !managementReady.value) return
  cleaning.value = action.id; error.value = ''; message.value = ''
  let completed = false
  try { completed = await props.bridge.clean(action.id); if (completed && !disposed) message.value = `${action.title}已完成，正在重新核对占用。` }
  catch { if (!disposed) { managementReady.value = false; error.value = '清理未能完成，部分项目可能已处理。请重新扫描后重试。' } }
  finally { cleaning.value = '' }
  if (!disposed && completed) { await scan(); if (!error.value) message.value = `${action.title}已完成，存储统计已更新。缓存可能在使用时重新生成。` }
}
async function reveal(path: string) { try { await props.bridge.reveal(path) } catch { error.value = '未能打开文件位置，请重新扫描后重试。' } }
onMounted(scan)
onUnmounted(() => { disposed = true; void props.bridge.cancel().catch(() => {}) })
</script>
<style>
.storage-workstation { --storage-install: light-dark(#6479a2, #97add6); --storage-data: light-dark(#876bae, #b79ad6); --storage-content: light-dark(#b08550, #d4ad7c); --storage-web: light-dark(#4e8d92, #82b7bc); --storage-cache: light-dark(#398267, #7cb69b); --storage-system: light-dark(#82828b, #a4a4af); --storage-unknown: light-dark(#b1a1a1, #bba7a7); --storage-success: light-dark(#28684c, #a0d3b8); --storage-danger: light-dark(#b42318, #ffaaa3); --storage-secondary: light-dark(#61616b, #b8b8c0); max-width: 1400px; margin: 0 auto; }
.storage-workstation h2, .storage-workstation h3 { margin: 0; font-size: 14px; font-weight: 600; }
.storage-workstation h2 { font-size: 20px; }
.storage-workstation input:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
.storage-workstation ::selection { color: var(--card); background: var(--brand); }
.storage-heading { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin: 4px 0 20px; }
.storage-heading p { margin-top: 5px; font-size: 13px; color: var(--storage-secondary); }
.storage-heading .action { flex-shrink: 0; }
.storage-dashboard { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr); border: 1px solid var(--border); border-radius: 12px; background: var(--card); overflow: hidden; }
.storage-footprint, .storage-volume { padding: 20px 24px; min-width: 0; }
.storage-volume { border-left: 1px solid var(--border); background: var(--surface); }
.storage-panel-title { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.storage-panel-title > span { margin-left: auto; font-size: 12px; color: var(--storage-secondary); }
.storage-disk-status { border: 1px solid var(--border); padding: 1px 6px; border-radius: 4px; }
.storage-measure { margin: 16px 0 6px; font-variant-numeric: tabular-nums; }
.storage-measure strong { font-size: 26px; line-height: 1.3; font-weight: 600; letter-spacing: -.02em; }
.storage-disk-share { color: var(--storage-secondary); font-size: 13px; }
.storage-free strong { font-size: 22px; }
.storage-disk-capacity { color: var(--storage-secondary); }
.storage-comparison-heading { color: var(--storage-secondary); margin-top: 20px; margin-bottom: 6px; font-size: 12px; }
.storage-comparison { display: grid; gap: 2px; }
.storage-comparison button { display: grid; grid-template-columns: minmax(110px, 1.2fr) minmax(24px, 1fr) 72px; align-items: center; gap: 12px; font-size: 12px; padding: 4px 0; text-align: left; border-radius: 3px; }
.storage-comparison button:hover, .storage-comparison button[aria-pressed=true] { background: var(--hover); }
.storage-comparison button > span:first-child { color: var(--storage-secondary); }
.storage-comparison b { font-variant-numeric: tabular-nums; font-weight: 500; text-align: right; white-space: nowrap; }
.storage-comparison-bar i { display: block; height: 7px; border-radius: 2px; }
.storage-volume-bar { display: flex; height: 22px; border-radius: 4px; overflow: hidden; margin: 24px 0 14px; outline: 1px solid var(--border); }
.storage-volume-bar > i { height: 100%; }
.storage-volume-mira { background: var(--brand); }
.storage-volume-used { background: light-dark(#b4b4be, #777783); }
.storage-volume-free { background: light-dark(#deeee5, #365e48); }
.storage-volume-legend { margin: 0; font-size: 12px; }
.storage-volume-legend > div { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 7px 0; }
.storage-volume-legend dt { display: flex; align-items: center; gap: 8px; color: var(--storage-secondary); }
.storage-volume-legend dt i { display: inline-block; flex-shrink: 0; width: 8px; height: 8px; border-radius: 2px; }
.storage-volume-legend dd { margin: 0; font-variant-numeric: tabular-nums; white-space: nowrap; }
.storage-volume-available { border-top: 1px solid var(--border); margin-top: 6px; }
.storage-volume-available dt, .storage-volume-available dd { color: var(--storage-success); font-weight: 600; }
.storage-volume-unknown { margin-top: 24px; color: var(--storage-secondary); }
.storage-reclaim { display: flex; gap: 12px; align-items: center; padding: 16px 4px; margin-bottom: 12px; color: var(--storage-success); }
.storage-reclaim > div { flex: 1; min-width: 0; }
.storage-reclaim strong { font-weight: 600; font-variant-numeric: tabular-nums; }
.storage-reclaim p { color: var(--storage-secondary); font-size: 12px; margin-top: 3px; }
.storage-reclaim > svg, .storage-reclaim > button { flex-shrink: 0; }
.storage-breakdown { border: 1px solid var(--border); background: var(--card); border-radius: 12px; overflow: hidden; scroll-margin-top: 16px; }
.storage-list-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
.storage-view-switch { display: flex; gap: 2px; padding: 2px; border-radius: 6px; background: var(--surface); }
.storage-view-switch button { padding: 4px 10px; font-size: 12px; border-radius: 4px; }
.storage-view-switch button[aria-pressed=true] { background: var(--selected); font-weight: 600; }
.storage-search { display: flex; align-items: center; gap: 6px; margin-left: auto; border: 1px solid var(--border); border-radius: 6px; padding: 5px 8px; color: var(--storage-secondary); }
.storage-search input { background: transparent; border: 0; width: 180px; min-width: 80px; font-size: 12px; }
.storage-search input::placeholder { color: var(--storage-secondary); }
.storage-clean-filter { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--storage-secondary); cursor: pointer; white-space: nowrap; }
.storage-clean-filter input { accent-color: var(--brand); }
.storage-table-heading, .storage-group-button { display: grid; grid-template-columns: minmax(0, 1fr) 140px 100px 16px; gap: 16px; align-items: center; width: 100%; padding: 10px 16px; text-align: left; }
.storage-table-heading { background: var(--surface); color: var(--storage-secondary); font-size: 12px; }
.storage-table-heading > span:nth-child(2), .storage-table-heading > span:nth-child(3) { text-align: right; }
.storage-group + .storage-group { border-top: 1px solid var(--border); }
.storage-group-button { min-height: 68px; }
.storage-group-button:hover { background: var(--surface); }
.storage-group-name { display: flex; align-items: center; gap: 12px; min-width: 0; }
.storage-group-name > svg { flex-shrink: 0; color: var(--storage-secondary); }
.storage-group-name > span { min-width: 0; }
.storage-group-name strong { display: block; font-weight: 500; overflow-wrap: anywhere; }
.storage-group-name small { display: block; font-size: 11px; color: var(--storage-secondary); margin-top: 3px; }
.storage-group-size { text-align: right; font-variant-numeric: tabular-nums; }
.storage-group-size b { font-weight: 500; font-size: 13px; }
.storage-rank-bar { display: block; height: 3px; background: var(--surface); margin-top: 6px; border-radius: 2px; overflow: hidden; }
.storage-rank-bar i { display: block; height: 100%; background: var(--storage-web); }
.storage-cache-value { font-size: 12px; font-variant-numeric: tabular-nums; color: var(--storage-success); text-align: right; }
.storage-group-detail { padding: 0 16px 12px 45px; border-top: 1px solid var(--border); }
.storage-file-row { display: flex; align-items: start; gap: 10px; padding: 12px 0; border-bottom: 1px solid var(--border); }
.storage-file-row > svg { margin-top: 3px; flex-shrink: 0; }
.storage-file-row > div { flex: 1; min-width: 0; }
.storage-file-row strong { font-size: 12px; font-weight: 500; overflow-wrap: anywhere; }
.storage-file-row p { font-size: 11px; overflow-wrap: anywhere; }
.storage-file-path { color: var(--storage-secondary); margin-top: 4px; }
.storage-file-size { font-size: 12px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.storage-reveal { flex-shrink: 0; padding: 5px 7px; }
.storage-cleanup-row { display: flex; gap: 20px; align-items: center; padding-top: 14px; }
.storage-cleanup-row > div { flex: 1; min-width: 0; }
.storage-cleanup-row strong { font-weight: 500; font-size: 12px; }
.storage-cleanup-row p { font-size: 11px; color: var(--storage-secondary); max-width: 75ch; margin-top: 3px; }
.storage-cleanup-row .action { flex-shrink: 0; }
.storage-destructive { color: var(--storage-danger); }
.storage-notice { border: 1px solid var(--border); background: var(--surface); border-radius: 6px; padding: 10px 12px; font-size: 12px; margin: 0 0 16px; }
.storage-failure { color: var(--storage-danger); }
.storage-active-filter { display: flex; gap: 12px; align-items: center; padding: 8px 16px; }
.storage-footer { color: var(--storage-secondary); font-size: 11px; padding: 16px 4px 4px; }
.storage-footer > div { display: flex; gap: 6px; align-items: center; overflow-wrap: anywhere; }
.storage-footer > div svg { flex-shrink: 0; }
.storage-footer p { margin: 6px 0; max-width: 100ch; }
.storage-initial { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 64px 24px; color: var(--storage-secondary); }
.storage-initial p { max-width: 50ch; text-align: center; }
.storage-no-results { padding: 32px 16px; text-align: center; color: var(--storage-secondary); font-size: 13px; }
.storage-spinning { animation: storage-scan-spin 1s linear infinite; }
@keyframes storage-scan-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .storage-spinning { animation: none; } }
@media (max-width: 760px) { .storage-footprint, .storage-volume { padding: 16px; } .storage-dashboard { grid-template-columns: minmax(0, 1fr); } .storage-volume { border-left: 0; border-top: 1px solid var(--border); } .storage-table-heading, .storage-group-button { grid-template-columns: minmax(0, 1fr) 100px 80px 16px; gap: 10px; } .storage-search input { width: 130px; } }
</style>
