<template>
  <div ref="stage" class="platform-app-stage">
    <el-result v-if="error" icon="error" title="应用无法加载" :sub-title="error">
      <template #extra><el-button type="primary" @click="open">重试</el-button></template>
    </el-result>
    <span v-else-if="loading" class="platform-app-status" role="status">正在打开应用…</span>
  </div>
</template>

<script setup lang="ts">
import { inject, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import type { PlatformApi } from '@/types'

const props = defineProps<{ appId: string; api: PlatformApi }>()
const shellOverlayOpen = inject<Readonly<Ref<boolean>>>('mira-shell-overlay-open', ref(false))
const stage = ref<HTMLElement>()
const error = ref('')
const loading = ref(false)
let viewId: number | undefined
let generation = 0
let observer: ResizeObserver | undefined
let unsubscribeFailure: (() => void) | undefined
let unsubscribeZoom: (() => void) | undefined

function syncBounds() {
  if (viewId === undefined || !stage.value) return
  const rect = stage.value.getBoundingClientRect()
  const bounds = { x: Math.max(0, Math.round(rect.x)), y: Math.max(0, Math.round(rect.y)), width: Math.max(0, Math.round(rect.width)), height: Math.max(0, Math.round(rect.height)) }
  void props.api.appView.setBounds(viewId, bounds).catch(() => undefined)
}
function syncOverlay() {
  document.documentElement.classList.toggle('mira-native-overlay', shellOverlayOpen.value)
  if (viewId !== undefined) void props.api.appView.setShellOverlay(viewId, shellOverlayOpen.value).catch(() => undefined)
}
watch(shellOverlayOpen, syncOverlay, { flush: 'sync' })

async function open() {
  const current = ++generation
  loading.value = true; error.value = ''
  try {
    const id = await props.api.appView.open(props.appId)
    if (current !== generation) { await props.api.appView.close(id).catch(() => undefined); return }
    viewId = id
    syncBounds()
    syncOverlay()
  } catch {
    if (current === generation) error.value = '无法打开应用，请检查安装状态后重试。'
  } finally { if (current === generation) loading.value = false }
}

onMounted(() => {
  observer = new ResizeObserver(syncBounds)
  if (stage.value) observer.observe(stage.value)
  window.addEventListener('resize', syncBounds)
  unsubscribeZoom = props.api.onDesktopZoomChanged?.(syncBounds)
  unsubscribeFailure = props.api.appView.onFailed(event => {
    if (event.id !== viewId) return
    viewId = undefined; error.value = event.message
  })
  void open()
})
onBeforeUnmount(() => {
  generation++
  document.documentElement.classList.remove('mira-native-overlay')
  observer?.disconnect(); unsubscribeZoom?.(); unsubscribeFailure?.()
  window.removeEventListener('resize', syncBounds)
  if (viewId !== undefined) void props.api.appView.close(viewId).catch(() => undefined)
})
</script>

<style scoped>
.platform-app-stage { position: relative; display: flex; flex: 1; min-width: 0; min-height: 0; align-items: center; justify-content: center; }
.platform-app-status { color: var(--cp-text-secondary); font-size: var(--settings-text-base); }
</style>
