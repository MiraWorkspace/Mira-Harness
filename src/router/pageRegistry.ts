import { defineAsyncComponent, defineComponent, h } from 'vue'
import type { RouteRecordRaw } from 'vue-router'
import type { Component } from 'vue'
import type { MenuItem } from '@/types'

export function getMenuRouteName(menu: MenuItem) {
  return menu.name || `Menu_${menu.id}`
}

export function getMenuRouteCacheName(menu: MenuItem) {
  return `MenuCache_${menu.id}`
}

function createMenuComponent(menu: MenuItem, loader: () => Promise<{ default: Component }>) {
  const Page = defineAsyncComponent(loader)
  return defineComponent({
    name: getMenuRouteCacheName(menu),
    setup: () => () => h(Page),
  })
}

function createRouteMeta(menu: MenuItem) {
  return {
    title: menu.title,
    icon: menu.icon,
    menuId: menu.id,
    pageTitle: menu.title,
    pageDescription: menu.description,
    showPageHeader: menu.showPageHeader,
    keepAlive: menu.keepAlive === true,
    cacheName: getMenuRouteCacheName(menu),
  }
}

export function createBusinessRoute(menu: MenuItem): RouteRecordRaw | null {
  if (!menu.path || !menu.target) return null

  if (menu.target.type === 'iframe') {
    return {
      path: menu.path,
      name: getMenuRouteName(menu),
      component: createMenuComponent(menu, () => import('@/pages/frontend/embeddedWeb/index.vue')),
      meta: createRouteMeta(menu),
    }
  }

  return null
}
