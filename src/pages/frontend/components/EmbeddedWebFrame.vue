<template>
  <AppLoadingOverlay class="embedded-web-frame-loading" :class="{ 'is-fill': fill }" :active="loading" text="正在加载网页…">
  <div class="embedded-web-frame" :class="{ 'is-fill': fill }">
    <el-result v-if="error" icon="error" title="网页无法加载" sub-title="页面打开失败，您可以尝试以下方式重试">
      <template #extra>
        <el-button v-if="resolvedUrl" type="primary" @click="openInNewWindow">在新窗口打开</el-button>
        <el-button @click="reload">重试</el-button>
      </template>
    </el-result>

    <el-result
      v-else-if="resolvedPolicy.profile === 'external'"
      icon="info"
      title="该页面配置为在新窗口打开"
      sub-title="当前站点不在平台内嵌入，以保留完整的原站体验。"
    >
      <template #extra>
        <el-button type="primary" @click="openInNewWindow">在新窗口打开</el-button>
      </template>
    </el-result>

    <iframe
      v-else
      :key="frameKey"
      class="embedded-web-frame__iframe"
      ref="iframe"
      :src="resolvedUrl"
      :sandbox="sandbox"
      :referrerpolicy="resolvedPolicy.referrerPolicy"
      :allow="allowPermissions"
      :allowfullscreen="resolvedPolicy.profile === 'compatible'"
      :title="title"
      @load="handleLoad"
      @error="handleError"
    />
  </div>
  </AppLoadingOverlay>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getIframeSandbox, resolveHttpUrl, resolveIframePolicy } from '@/config/iframe'
import type { IframePolicy } from '@/types'
import AppLoadingOverlay from '@/components/AppLoadingOverlay.vue'
import { useThemeStore } from '@/stores/theme'

const props = withDefaults(defineProps<{
  url: string
  title?: string
  policy?: IframePolicy
  fill?: boolean
  syncTheme?: boolean
}>(), {
  title: '嵌入网页',
  fill: false,
})

const themeStore = useThemeStore()
const loading = ref(false)
const error = ref(false)
const reloadKey = ref(0)
const resolvedUrl = ref('')
const iframe = ref<HTMLIFrameElement>()
let timer: number | undefined

const resolvedPolicy = computed(() => resolveIframePolicy(props.policy))
const sandbox = computed(() => getIframeSandbox(resolvedPolicy.value.profile))
const allowPermissions = computed(() => resolvedPolicy.value.profile === 'compatible'
  ? 'fullscreen; clipboard-read; clipboard-write'
  : undefined
)
const frameKey = computed(() => `${resolvedUrl.value}:${reloadKey.value}`)

function clearTimer() {
  if (timer !== undefined) window.clearTimeout(timer)
  timer = undefined
}

function startLoading() {
  clearTimer()
  error.value = false
  try {
    resolvedUrl.value = resolveHttpUrl(props.url)
  } catch (cause: any) {
    resolvedUrl.value = ''
    loading.value = false
    error.value = cause.message || '网页地址无效'
    return
  }
  loading.value = resolvedPolicy.value.profile !== 'external'
  if (!loading.value) return

  timer = window.setTimeout(() => {
    loading.value = false
  }, resolvedPolicy.value.timeout * 1000)
}

function handleLoad() {
  clearTimer()
  loading.value = false
  syncTheme()
}

function handleError() {
  clearTimer()
  loading.value = false
  error.value = true
}

function reload() {
  reloadKey.value++
  startLoading()
}

function openInNewWindow() {
  if (resolvedUrl.value) window.open(resolvedUrl.value, '_blank', 'noopener,noreferrer')
}

function syncTheme() {
  if (!props.syncTheme || !iframe.value?.contentWindow || !resolvedUrl.value) return
  try {
    iframe.value.contentWindow.postMessage({ type: 'mira:theme', theme: themeStore.themeMode }, new URL(resolvedUrl.value).origin)
  } catch { /* The frame may navigate while the theme is being sent. */ }
}

function relayShortcut(event: MessageEvent) {
  if (!props.syncTheme || event.source !== iframe.value?.contentWindow || !resolvedUrl.value || event.origin !== new URL(resolvedUrl.value).origin) return
  const message = event.data
  if (!message || message.type !== 'mira:shortcut' || message.sourceApp !== 'mira-workbench' || typeof message.key !== 'string' || message.key.length > 32) return
  document.dispatchEvent(new KeyboardEvent('keydown', {
    key: message.key, code: typeof message.code === 'string' ? message.code : '', keyCode: Number(message.keyCode) || 0,
    metaKey: message.metaKey === true, ctrlKey: message.ctrlKey === true, shiftKey: message.shiftKey === true,
    altKey: message.altKey === true, repeat: message.repeat === true, isComposing: message.isComposing === true,
  }))
}

function relayWorkbenchBrowserEvent(event: MessageEvent) {
  if (event.source !== window || !iframe.value?.contentWindow) return
  const message = event.data as { type?: unknown; url?: unknown } | undefined
  if (message?.type !== 'mira:workbench-open-tab' || typeof message.url !== 'string') return
  try {
    const url = new URL(message.url)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return
    iframe.value.contentWindow.postMessage({ type: message.type, url: url.href }, '*')
  } catch { /* The host only forwards validated browser URLs. */ }
}

watch([() => props.url, () => props.policy], startLoading, { immediate: true, deep: true })
watch(() => themeStore.themeMode, syncTheme)
onMounted(() => {
  window.addEventListener('message', relayShortcut)
  window.addEventListener('message', relayWorkbenchBrowserEvent)
})
onBeforeUnmount(() => {
  clearTimer()
  window.removeEventListener('message', relayShortcut)
  window.removeEventListener('message', relayWorkbenchBrowserEvent)
})
</script>

<style scoped lang="scss">
.embedded-web-frame {
  min-height: 560px;

  &.is-fill {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;

    .embedded-web-frame__iframe {
      flex: 1;
      min-height: 0;
    }
  }
}

.embedded-web-frame-loading.is-fill {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.embedded-web-frame__iframe {
  display: block;
  width: 100%;
  min-height: 560px;
  border: 0;
}
</style>
