import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { expect, it } from 'vitest'

it('opens a frame-ancestors none page through the shell while keeping Workbench isolated', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mira-workbench-browser-'))
  try {
    await writeFile(join(directory, 'main.cjs'), main)
    await build({ stdin: { contents: renderer, resolveDir: process.cwd(), loader: 'ts' }, outfile: join(directory, 'host.js'), bundle: true, platform: 'browser' })
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS
    const { stdout, stderr } = await promisify(execFile)(createRequire(import.meta.url)('electron'), [join(directory, 'main.cjs')], { env, timeout: 20000 })
    const line = stdout.split('\n').find(line => line.startsWith('RESULT='))
    if (!line) throw new Error(stdout + stderr)
    const result = JSON.parse(line.slice(7))
    expect(result).toEqual({ blockedIframe: true, isolated: ['undefined', 'undefined'], title: 'Loaded page', partition: true, back: true, retained: true, hidden: true, closed: true })
  } finally { await rm(directory, { recursive: true, force: true }) }
}, 30000)

const renderer = `
import { WorkbenchBrowserHost } from ${JSON.stringify(resolve('src/platform/workbenchBrowserHost.ts'))}
const frame = document.querySelector('iframe'), host = new WorkbenchBrowserHost(frame, document.body)
window.addEventListener('message', event => host.connect(event, frame.src))
`

const main = `
const { app, BrowserWindow, webContents, session } = require('electron')
const http = require('http')
const fs = require('fs')
app.setPath('userData', require('path').join(__dirname, 'profile'))
app.whenReady().then(async () => {
 let win, server
 try {
  server = http.createServer((req, res) => {
   res.setHeader('Content-Type', 'text/html; charset=utf-8')
   if (req.url === '/host.js') { res.setHeader('Content-Type','text/javascript'); res.end(fs.readFileSync(require('path').join(__dirname,'host.js'))) }
   else if (req.url.startsWith('/site')) { res.setHeader('Content-Security-Policy', "frame-ancestors 'none'"); res.end('<title>Loaded page</title><a href="/site/next">Next</a>') }
   else if (req.url === '/workbench') res.end('<!doctype html><iframe src="/site"></iframe><script>window.states=[];window.addEventListener("message",event=>{if(event.data.type!=="mira:workbench-browser-connected")return;window.port=event.ports[0];port.onmessage=e=>states.push(e.data)});parent.postMessage({type:"mira:workbench-browser-connect"},"*")</script>')
   else res.end('<!doctype html><body style="position:relative;margin:0;width:100vw;height:100vh"><iframe style="width:900px;height:600px;border:0" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads" src="http://127.0.0.1:'+server.address().port+'/workbench"></iframe><script src="/host.js"></script>')
  })
  await new Promise(done=>server.listen(0,done))
  win=new BrowserWindow({show:false,webPreferences:{webviewTag:true,contextIsolation:true,nodeIntegration:false,sandbox:false}})
  win.webContents.on('will-attach-webview',(_,prefs)=>{prefs.nodeIntegration=false;prefs.sandbox=true;prefs.contextIsolation=true;prefs.webSecurity=true})
  let blockedIframe=false
  const messages=[]
  win.webContents.on('console-message',(_event,_level,message)=>{messages.push(message);if(message.includes('frame-ancestors'))blockedIframe=true})
  const base='http://127.0.0.1:'+server.address().port
  await win.loadURL('http://localhost:'+server.address().port)
  const child=win.webContents.mainFrame.frames.find(frame=>frame.url.endsWith('/workbench'))
  const inspect=code=>child.executeJavaScript(code)
  const wait=async fn=>{const deadline=Date.now()+7000;while(Date.now()<deadline){if(await fn())return;await new Promise(r=>setTimeout(r,20))}throw Error('Timeout '+fn+' '+JSON.stringify(messages))}
  const send=message=>inspect('port.postMessage('+JSON.stringify(message)+')')
  await wait(()=>inspect('!!window.port'))
  const isolated=await inspect('[typeof window.process,typeof document.createElement("webview").getWebContentsId]')
  await win.webContents.executeJavaScript('window.postMessage({type:"mira:workbench-browser-connect"},"*")')
  await send({type:'open',tabId:'file',url:'file:///not-allowed'})
  await send({type:'open',tabId:'script',url:'javascript:alert(1)'})
  await send({type:'open',tabId:'credentials',url:'https://user:secret@example.com/'})
  await send({type:'open',tabId:'one',url:base+'/site'})
  await send({type:'layout',tabId:'one',bounds:{x:20,y:50,width:600,height:400},visible:true})
  await wait(()=>inspect('states.some(s=>s.title==="Loaded page"&&!s.loading)'))
  const guest=webContents.getAllWebContents().find(contents=>contents.getType()==='webview')
  if(webContents.getAllWebContents().filter(contents=>contents.getType()==='webview').length!==1)throw Error('Invalid guest URL was accepted')
  await wait(()=>!guest.isLoadingMainFrame())
  const title=guest.getTitle(), partition=guest.session===session.fromPartition('persist:mira-workbench'), id=guest.id
  await guest.executeJavaScript('document.querySelector("a").click()',true)
  await wait(()=>guest.getURL().endsWith('/site/next')&&!guest.isLoadingMainFrame())
  await wait(()=>inspect('states.some(s=>s.url.endsWith("/site/next")&&s.canGoBack)'))
  await send({type:'control',tabId:'one',action:'back'})
  await wait(()=>guest.getURL()===base+'/site')
  const back=true
  await send({type:'layout',tabId:'home',bounds:{x:0,y:0,width:0,height:0},visible:false})
  await wait(()=>win.webContents.executeJavaScript('document.querySelector("webview").style.display==="none"'))
  const hidden=true
  await send({type:'layout',tabId:'one',bounds:{x:20,y:50,width:600,height:400},visible:true})
  await wait(()=>win.webContents.executeJavaScript('document.querySelector("webview").style.display==="flex"'))
  const retained=!guest.isDestroyed()&&guest.id===id
  await send({type:'control',tabId:'one',action:'close'})
  await wait(()=>win.webContents.executeJavaScript('!document.querySelector("webview")'))
  console.log('RESULT='+JSON.stringify({blockedIframe,isolated,title,partition,back,retained,hidden,closed:true}))
 } catch(error) { console.error(error); process.exitCode=1 }
 finally { win?.destroy(); server?.close(); app.quit() }
})
`
