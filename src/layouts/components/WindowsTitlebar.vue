<template>
  <div class="windows-titlebar" aria-label="Windows 窗口标题栏">
    <div v-if="dragRegion" class="windows-titlebar__drag-region" aria-hidden="true" />

    <div class="windows-titlebar__window-controls" aria-label="窗口控制">
      <button type="button" class="windows-titlebar__window-control" title="最小化" aria-label="最小化" @click="runWindowCommand('minimize')">
        <Minus :size="14" />
      </button>
      <button type="button" class="windows-titlebar__window-control" :title="maximized ? '还原' : '最大化'" :aria-label="maximized ? '还原' : '最大化'" @click="runWindowCommand('maximize')">
        <Copy v-if="maximized" :size="13" /><Square v-else :size="12" />
      </button>
      <button type="button" class="windows-titlebar__window-control windows-titlebar__window-control--close" title="关闭窗口" aria-label="关闭窗口" @click="runWindowCommand('close')">
        <X :size="14" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import { Copy, Minus, Square, X } from 'lucide-vue-next'

withDefaults(defineProps<{ dragRegion?: boolean }>(), {
  dragRegion: true,
})

const maximized = ref(false)
const stopMaximized = window.platform?.onWindowMaximizedChanged?.(value => { maximized.value = value })
void window.platform?.isWindowMaximized?.().then(value => { maximized.value = value })
onUnmounted(() => stopMaximized?.())

function runWindowCommand(action: string) {
  void window.platform?.windowCommand(action)
}
</script>

<style scoped lang="scss">
.windows-titlebar {
  --windows-titlebar-height: var(--cp-titlebar-height, 36px);
}

.windows-titlebar__drag-region {
  position: fixed;
  z-index: 100;
  top: 0;
  right: 0;
  left: 0;
  height: var(--windows-titlebar-height);
  -webkit-app-region: drag;
}

.windows-titlebar__window-controls {
  position: fixed;
  z-index: 110;
  top: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  padding-right: 8px;
  height: var(--windows-titlebar-height);
  -webkit-app-region: no-drag;
}

.windows-titlebar__window-control {
  display: grid;
  width: 30px;
  height: 30px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 4px;
  color: var(--cp-text-secondary);
  background: transparent;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    color: var(--cp-text);
    background: var(--cp-bg-hover);
    outline: none;
  }

  &--close:hover,
  &--close:focus-visible {
    color: #fff;
    background: #c42b1c;
  }
}

</style>
