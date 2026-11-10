import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { parse } from '@vue/compiler-sfc'
import { compileString } from 'sass'
import { expect, it } from 'vitest'

it('matches Harness menu surfaces and motion without moving the Popper positioning layer', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mira-app-switcher-'))
  try {
    const { descriptor } = parse(await readFile(resolve('src/layouts/index.vue'), 'utf8'))
    const shellStyle = compileString(descriptor.styles.find(style => !style.scoped)!.content).css
    const styles = await Promise.all([
      'node_modules/element-plus/theme-chalk/index.css',
      'apps/harness-react/src/styles/session.css',
      'apps/harness-react/src/styles/motion.css',
    ].map(path => readFile(resolve(path), 'utf8')))
    await writeFile(join(directory, 'index.html'), `<!doctype html><style>
      :root { --cp-text: #18181b; --cp-border: #e4e4e7; --cp-bg-overlay: white; }
      * { box-sizing: border-box; }
      ${styles.join('\n')}
      ${shellStyle}
    </style><div id="root">
      <div class="el-popover el-popper mira-app-switcher-popper" data-popper-placement="bottom-start" style="position:absolute;width:220px;transform:translate(90px,60px)">
        <nav class="mira-app-switcher"><button>Mira Harness</button><button>Mira Workbench</button></nav>
      </div>
      <div data-radix-popper-content-wrapper><div class="mira-session-menu" data-state="open" data-side="bottom">Harness menu</div></div>
    </div>`)
    await writeFile(join(directory, 'main.cjs'), main)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS
    const { stdout, stderr } = await promisify(execFile)(createRequire(import.meta.url)('electron'), [join(directory, 'main.cjs')], { env, timeout: 20000 })
    const line = stdout.split('\n').find(value => value.startsWith('RESULT='))
    if (!line) throw new Error(stdout + stderr)
    expect(JSON.parse(line.slice(7))).toEqual({ surface: true, enter: true, exit: true, positioning: true, flipped: true, reducedMotion: true })
  } finally { await rm(directory, { recursive: true, force: true }) }
}, 30000)

const main = `
const { app, BrowserWindow } = require('electron')
app.setPath('userData', require('path').join(__dirname, 'profile'))
app.whenReady().then(async () => {
  let owner
  try {
    owner = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
    await owner.loadFile(require('path').join(__dirname, 'index.html'))
    const result = await owner.webContents.executeJavaScript(\`(() => {
      const popper = document.querySelector('.mira-app-switcher-popper'), surface = popper.firstElementChild
      const reference = document.querySelector('.mira-session-menu')
      const check = (ok, message) => { if (!ok) throw Error(message) }
      const style = node => getComputedStyle(node)
      check(style(surface).borderRadius === style(reference).borderRadius, 'Menu radius differs from Harness')
      check(style(surface).boxShadow === style(reference).boxShadow, 'Menu shadow differs from Harness')
      check(style(surface).padding === style(reference).padding, 'Menu padding differs from Harness')
      check(style(popper).backgroundColor === 'rgba(0, 0, 0, 0)' && style(popper).boxShadow === 'none' && style(popper).borderTopWidth === '0px', 'Positioning layer still paints a stationary frame')
      const rect = () => { const r = popper.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].join(',') }
      const initial = rect()
      const sample = (node, time) => {
        const animation = node.getAnimations().find(value => value instanceof CSSAnimation)
        check(Boolean(animation), 'Missing surface animation')
        animation.pause(); animation.currentTime = time
        return { scale: style(node).scale, translate: style(node).translate, duration: animation.effect.getTiming().duration, easing: animation.effect.getTiming().easing }
      }
      popper.classList.add('mira-app-menu-enter-active')
      for (const time of [0, 50, 150]) {
        check(JSON.stringify(sample(surface, time)) === JSON.stringify(sample(reference, time)), 'Entrance differs from Harness at ' + time)
        check(rect() === initial, 'Entrance moved Popper positioning')
      }
      check(surface.getBoundingClientRect().x === popper.getBoundingClientRect().x && surface.getBoundingClientRect().width === 220, 'Surface does not fill positioning layer')
      popper.className = 'el-popover el-popper mira-app-switcher-popper mira-app-menu-leave-active'
      reference.dataset.state = 'closed'
      for (const time of [0, 50, 100]) {
        check(JSON.stringify(sample(surface, time)) === JSON.stringify(sample(reference, time)), 'Exit differs from Harness at ' + time)
        check(rect() === initial, 'Exit moved Popper positioning')
      }
      check(style(popper).pointerEvents === 'none', 'Exiting menu intercepts clicks')
      popper.classList.remove('mira-app-menu-leave-active'); void popper.offsetWidth
      popper.dataset.popperPlacement = 'top-start'; reference.dataset.side = 'top'; reference.dataset.state = 'open'
      popper.classList.add('mira-app-menu-enter-active')
      check(JSON.stringify(sample(surface, 0)) === JSON.stringify(sample(reference, 0)), 'Flipped entrance differs from Harness')
      check(style(surface).transformOrigin.endsWith(surface.offsetHeight + 'px'), 'Flipped menu scales from wrong edge')
      return { surface: true, enter: true, exit: true, positioning: true, flipped: true }
    })()\`)
    owner.webContents.setBackgroundThrottling(false)
    owner.webContents.debugger.attach('1.3')
    await owner.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    result.reducedMotion = await owner.webContents.executeJavaScript('getComputedStyle(document.querySelector(".mira-app-switcher")).animationName === "none"')
    console.log('RESULT=' + JSON.stringify(result))
  } catch (error) { console.error(error); process.exitCode = 1 }
  finally { if (owner) owner.destroy(); app.quit() }
})
`
