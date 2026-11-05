import { defineComponent, h } from 'vue'
import { expect, it, vi } from 'vitest'
import AppearanceSettings from '../src/pages/backend/appearance/components/AppearanceSettings.vue'
import { createVueNodeRenderer, withVueClientRender } from './helpers/vueNodeRenderer'

const host = vi.hoisted(() => ({ setLoadingStyle: vi.fn() }))
vi.mock('@/hooks/useLoading', () => ({ useLoading: () => ({ style: { value: 'cube-grid' }, setStyle: host.setLoadingStyle }) }))
vi.mock('@/stores/theme', () => ({ useThemeStore: () => ({ themePreference: 'light', setThemeModeWithTransition: vi.fn() }) }))
vi.mock('@/stores/layout', () => ({ useLayoutStore: () => ({ config: { themeTransitionAnimation: false }, setThemeTransitionAnimation: vi.fn() }) }))
vi.mock('@/components/AppLoadingIndicator.vue', () => ({ default: defineComponent({ setup: () => () => h('i') }) }))

const Page = withVueClientRender(AppearanceSettings, new URL('../src/pages/backend/appearance/components/AppearanceSettings.vue', import.meta.url))
const components = {
  ...Object.fromEntries(['ElSelect', 'ElOption', 'ElSwitch'].map(name => [name, defineComponent({ inheritAttrs: false, setup: (_props, { attrs, slots }) => () => h(name, attrs, slots.default?.()) })])),
  AppIcon: defineComponent({ setup: () => () => h('i') }),
}

it('lists all loading animations and saves the selected style', () => {
  const renderer = createVueNodeRenderer()
  const { app } = renderer.mount(Page, {}, components)
  const picker = renderer.all().find(node => node.type === 'ElSelect' && node.props['aria-label'] === '加载动画')!

  expect(picker.props['model-value']).toBe('cube-grid')
  const expectedStyles = [
    'element', 'orbit', 'plane', 'bounce', 'wave', 'pulse', 'flow', 'swing', 'circle', 'circle-fade', 'cube-grid', 'wandering-cubes', 'folding-cube', 'chasing-dots',
  ]
  expect(renderer.all().filter(node => node.type === 'ElOption' && expectedStyles.includes(node.props.value as string)).map(node => node.props.value)).toEqual(expectedStyles)
  ;(picker.props['onUpdate:modelValue'] as (value: string) => void)('orbit')
  expect(host.setLoadingStyle).toHaveBeenCalledWith('orbit')
  app.unmount()
})
