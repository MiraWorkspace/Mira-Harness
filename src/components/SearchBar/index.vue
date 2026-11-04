<template>
  <el-dialog
    v-model="paletteStore.visible"
    class="search-dialog"
    modal-class="mira-search-overlay"
    :show-close="false"
    :close-on-click-modal="true"
    width="min(620px, calc(100% - 48px))"
    top="100px"
    @opened="focusInput"
    @close="handleClose"
  >
    <div ref="searchContainerRef" class="search-container">
      <div class="search-input-row"><el-input
        ref="searchInputRef"
        v-model="keyword"
        size="large"
        placeholder="搜索菜单、页面、应用或命令"
        clearable
        @keydown.up.prevent="moveActive(-1)"
        @keydown.down.prevent="moveActive(1)"
        @keydown.enter.prevent="selectActive"
      ><template #prefix><AppIcon name="Search" /></template></el-input><button class="search-close" type="button" aria-label="关闭全局搜索" @click="handleClose"><AppIcon name="Close" /></button></div>

      <div v-if="keyword" class="search-results">
        <template v-for="(item, index) in filteredResults" :key="item.id">
          <div v-if="index === 0 || item.category !== filteredResults[index - 1]?.category" class="result-section">
            {{ categoryLabels[item.category] }}
          </div>
          <button
            class="result-item"
            :class="{ 'is-active': index === activeIndex }"
            type="button"
            @click="handleSelect(item)"
            @mouseenter="activeIndex = index"
          >
            <AppIcon class="result-icon" :name="item.icon || 'Grid'" />
            <span class="result-content">
              <span class="result-title">{{ item.title }}</span>
              <span v-if="item.parent || item.path" class="result-path">{{ item.parent || item.path }}</span>
            </span>
            <span class="result-category">{{ categoryLabels[item.category] }}</span>
          </button>
        </template>
      </div>

      <div v-else class="default-sections">
        <section v-if="recentResults.length" class="default-section">
          <div class="section-heading">
            <span>最近使用</span>
            <el-button v-if="recentResults.length > 3" link size="small" @click="showAllRecent = !showAllRecent">
              {{ showAllRecent ? '收起' : '展开' }}
            </el-button>
          </div>
          <button
            v-for="(item, index) in visibleRecentResults"
            :key="item.id"
            class="result-item"
            :class="{ 'is-active': index === activeIndex }"
            type="button"
            @click="handleSelect(item)"
            @mouseenter="activeIndex = index"
          >
            <AppIcon class="result-icon" :name="item.icon || 'Grid'" />
            <span class="result-content">
              <span class="result-title">{{ item.title }}</span>
              <span v-if="item.parent || item.path" class="result-path">{{ item.parent || item.path }}</span>
            </span>
          </button>
        </section>

        <section class="default-section">
          <div class="section-heading"><span>系统操作</span></div>
          <button
            v-for="(item, index) in commandActions"
            :key="item.id"
            class="result-item"
            :class="{ 'is-active': index + visibleRecentResults.length === activeIndex }"
            type="button"
            @click="handleSelect(item)"
            @mouseenter="activeIndex = index + visibleRecentResults.length"
          >
            <AppIcon class="result-icon" :name="item.icon || 'Grid'" />
            <span class="result-content">
              <span class="result-title">{{ item.title }}</span>
              <span v-if="item.parent" class="result-path">{{ item.parent }}</span>
            </span>
          </button>
        </section>
      </div>

      <div v-if="keyword && !filteredResults.length" class="search-empty">
        <el-empty description="未找到相关内容" :image-size="72" />
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { pinyin } from 'pinyin-pro'
import { findCommandNavigation, getCommandNavigationItems } from '@/config/commandPalette'
import { navigateToPath } from '@/config/navigation'
import type { CommandNavigationCategory, CommandNavigationItem } from '@/config/commandPalette'
import { useCommandPaletteStore } from '@/stores/commandPalette'
import { isMiraPrimaryModifier } from '@/platform/workbenchShortcuts'
import { useLayoutStore } from '@/stores/layout'
import { useThemeStore } from '@/stores/theme'

const router = useRouter()
const paletteStore = useCommandPaletteStore()
const layoutStore = useLayoutStore()
const themeStore = useThemeStore()
const keyword = ref('')
const activeIndex = ref(0)
const showAllRecent = ref(false)
const searchInputRef = ref()
const searchContainerRef = ref<HTMLElement>()
const isFullscreen = ref(Boolean(document.fullscreenElement))
const searchTokenCache = new Map<string, string[]>()

type CommandPaletteItem = CommandNavigationItem | (Omit<CommandNavigationItem, 'category' | 'path'> & {
  category: 'command'
  path?: string
  action: () => void | Promise<void>
})

const categoryLabels: Record<CommandNavigationCategory | 'command', string> = {
  page: '页面',
  application: '应用',
  session: '最近对话',
  command: '系统操作',
}

const recentResults = computed(() => paletteStore.recentItems
  .map(item => findCommandNavigation(item.id))
  .filter((item): item is CommandNavigationItem => Boolean(item))
)
const visibleRecentResults = computed(() => showAllRecent.value ? recentResults.value : recentResults.value.slice(0, 3))
const commandActions = computed<CommandPaletteItem[]>(() => [
  {
    id: 'command-theme',
    title: themeStore.themeMode === 'light' ? '切换为深色模式' : '切换为浅色模式',
    icon: themeStore.themeMode === 'light' ? 'Moon' : 'Sunny',
    category: 'command',
    parent: '系统操作',
    action: () => themeStore.toggleThemeModeWithTransition(undefined, layoutStore.config.themeTransitionAnimation),
  },
  {
    id: 'command-fullscreen',
    title: isFullscreen.value ? '退出全屏' : '进入全屏',
    icon: isFullscreen.value ? 'Crop' : 'FullScreen',
    category: 'command',
    parent: '系统操作',
    action: async () => {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    },
  },
  {
    id: 'command-settings',
    title: '打开设置（全局配置）',
    icon: 'Setting',
    category: 'command',
    parent: '系统操作',
    action: async () => { await router.push({ path: '/settings/general', query: { from: router.currentRoute.value.fullPath } }) },
  },
  {
    id: 'command-usage',
    title: '用量与成本',
    icon: 'DataAnalysis',
    category: 'command',
    parent: '系统操作',
    action: async () => { await router.push({ path: '/settings/usage', query: { from: router.currentRoute.value.fullPath } }) },
  },
])
const defaultResults = computed(() => [
  ...visibleRecentResults.value,
  ...commandActions.value,
])

const filteredResults = computed(() => {
  const normalizedKeyword = normalizeSearchTerm(keyword.value)
  if (!normalizedKeyword) return []

  return [...getCommandNavigationItems(), ...commandActions.value]
    .map((item, index) => ({ item, index, score: matchScore(item, normalizedKeyword) }))
    .filter(entry => entry.score >= 0)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, 10)
    .map(entry => entry.item)
})

const selectableItems = computed(() => keyword.value ? filteredResults.value : defaultResults.value)

function matchScore(item: CommandPaletteItem, normalizedKeyword: string) {
  return [
    matchValue(item.title, normalizedKeyword, 0),
    matchValue(item.parent, normalizedKeyword, 10),
    matchValue(item.path, normalizedKeyword, 20),
  ].find(score => score >= 0) ?? -1
}

function matchValue(value: string | undefined, keyword: string, baseScore: number) {
  if (!value) return -1

  const [original, fullPinyin, initials] = getSearchTokens(value)
  if (original.includes(keyword)) return baseScore
  if (fullPinyin.includes(keyword)) return baseScore + 1
  if (initials.includes(keyword)) return baseScore + 2
  if ([original, fullPinyin, initials].some(token => isFuzzyMatch(token, keyword))) return baseScore + 3
  return -1
}

function getSearchTokens(value: string) {
  const cached = searchTokenCache.get(value)
  if (cached) return cached

  const syllables = pinyin(value, { toneType: 'none', type: 'array' })
  const tokens = [
    normalizeSearchTerm(value),
    normalizeSearchTerm(syllables.join('')),
    normalizeSearchTerm(syllables.map(syllable => syllable[0]).join('')),
  ]
  searchTokenCache.set(value, tokens)
  return tokens
}

function normalizeSearchTerm(value: string) {
  return value.toLowerCase().replace(/\s+/g, '')
}

function isFuzzyMatch(value: string, keyword: string) {
  let keywordIndex = 0
  for (const character of value) {
    if (character === keyword[keywordIndex]) keywordIndex++
    if (keywordIndex === keyword.length) return true
  }
  return false
}

function moveActive(direction: number) {
  const length = selectableItems.value.length
  if (!length) return
  activeIndex.value = (activeIndex.value + direction + length) % length
}

function selectActive() {
  const item = selectableItems.value[activeIndex.value]
  if (item) handleSelect(item)
}

async function handleSelect(item: CommandPaletteItem) {
  if ('action' in item) await item.action()
  else {
    const mode = await navigateToPath(router, item.path)
    if (mode === 'external') paletteStore.recordVisit(item.id)
  }
  handleClose()
}

function handleClose() {
  paletteStore.close()
  keyword.value = ''
  activeIndex.value = 0
  showAllRecent.value = false
}

function focusInput() {
  nextTick(() => searchInputRef.value?.focus())
}

function handleKeydown(event: KeyboardEvent) {
  const key = event.key.toLowerCase()
  if (!event.defaultPrevented && !event.isComposing && event.keyCode !== 229 && !event.repeat && !event.altKey && isMiraPrimaryModifier(event) && (event.shiftKey ? key === 'p' : key === 'k')) {
    event.preventDefault()
    paletteStore.open()
  } else if (event.key === 'Escape' && paletteStore.visible) {
    handleClose()
  }
}

function updateFullscreen() {
  isFullscreen.value = Boolean(document.fullscreenElement)
}

watch([keyword, selectableItems], () => {
  activeIndex.value = 0
})

watch(showAllRecent, () => {
  activeIndex.value = 0
})

watch(activeIndex, scrollActiveResultIntoView)

function scrollActiveResultIntoView() {
  nextTick(() => {
    searchContainerRef.value
      ?.querySelector<HTMLElement>('.result-item.is-active')
      ?.scrollIntoView({ block: 'nearest' })
  })
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
  document.addEventListener('fullscreenchange', updateFullscreen)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('fullscreenchange', updateFullscreen)
})
</script>

<style scoped lang="scss">
.search-container { display: flex; max-height: calc(100dvh - 124px); flex-direction: column; }
.search-input-row { display: flex; min-height: 52px; flex: none; align-items: center; gap: 10px; padding: 0 12px 0 16px; border-bottom: 1px solid var(--cp-border); }
.search-input-row :deep(.el-input) { flex: 1; }
.search-input-row :deep(.el-input__wrapper) { padding: 0; background: transparent; box-shadow: none; }
.search-input-row :deep(.el-input__wrapper.is-focus) { box-shadow: none; }
.search-input-row :deep(.el-input__inner) { height: 44px; color: var(--cp-text); font-size: 14px; }
.search-input-row :deep(.el-input__inner::placeholder), .search-input-row :deep(.el-input__prefix) { color: var(--cp-text-secondary); }
.search-input-row :deep(.el-input__prefix) { font-size: 18px; }
.search-close { display: grid; width: 28px; height: 28px; flex: none; place-items: center; border: 0; border-radius: 6px; background: transparent; color: var(--cp-text-secondary); cursor: pointer; }
.search-close:hover { background: var(--cp-bg-hover); color: var(--cp-text); }
.search-close:focus-visible, .result-item:focus-visible { outline: 2px solid var(--cp-text); outline-offset: -2px; }
.search-results, .default-sections { min-height: 88px; max-height: min(440px, calc(100dvh - 190px)); overflow-y: auto; overscroll-behavior: contain; padding: 4px 6px 8px; scrollbar-width: thin; }
.default-section + .default-section { margin-top: 4px; }
.section-heading, .result-section { display: flex; align-items: center; justify-content: space-between; padding: 10px 10px 5px; color: var(--cp-text-secondary); font-size: 12px; font-weight: 500; }
.result-item { display: flex; width: 100%; min-height: 38px; align-items: center; gap: 10px; padding: 8px 10px; border: 0; border-radius: 6px; background: transparent; color: var(--cp-text); text-align: left; cursor: pointer; transition: background 120ms ease-out; }
.result-item:hover, .result-item.is-active { background: var(--cp-bg-hover); }
.result-icon { flex: 0 0 16px; color: var(--cp-text-secondary); font-size: 16px; }
.result-content { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 2px; }
.result-title { overflow: hidden; font-size: 14px; font-weight: 400; text-overflow: ellipsis; white-space: nowrap; }
.result-path, .result-category { overflow: hidden; color: var(--cp-text-secondary); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.result-category { flex: 0 0 auto; }
.search-empty { padding: 8px 0; }
</style>

<style lang="scss">
.mira-search-overlay.el-overlay { background: transparent; }
.el-dialog.search-dialog { max-height: calc(100dvh - 124px); margin-bottom: 0; overflow: hidden; padding: 0; border: 0; border-radius: 8px; background: var(--cp-bg-overlay); box-shadow: 0 16px 48px rgb(0 0 0 / 22%), 0 4px 12px rgb(0 0 0 / 12%); }
.el-dialog.search-dialog .el-dialog__header { display: none; padding: 0; margin: 0; border: 0; }
.el-dialog.search-dialog .el-dialog__body { padding: 0; }
.dialog-fade-enter-active .el-dialog.search-dialog { animation: settings-surface-enter 180ms cubic-bezier(.16, 1, .3, 1) both; }
.dialog-fade-leave-active .el-dialog.search-dialog { animation: settings-surface-exit 100ms ease-in both; }
</style>
