import { waitForCompletedTurns, hostTurnDiagnostics } from './host-turn-state.mjs'
import { readCompatibility } from './ci-compatibility.mjs'
import { chromium } from 'playwright-core'
import { spawn, execFileSync } from 'node:child_process'
import { readFile, writeFile, mkdir, copyFile, rm, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse, stringify } from 'yaml'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
const version = process.argv[2]
const pkg = JSON.parse(await readFile('package.json', 'utf8'))
const tarball = resolve('artifacts', `${pkg.name}-${pkg.version}.tgz`)
if (!Object.hasOwn(readCompatibility().entries, version)) throw new Error('Specify an exact supported test version')
const root = resolve('artifacts/full-hosts', version)
const home = join(root, 'home')
const cli = join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
const profile = join(home, 'profiles/translation-smoke')
const env = { ...process.env, DSH_HOME: home }
await mkdir(home, { recursive: true })
const storePath = join(home, 'prompt-translation.yml')
await rm(storePath, { force: true })
const actual = JSON.parse(await readFile(join(root,'node_modules/@deepseek-ai/dsh/package.json'),'utf8')).version
assert.equal(actual, version)
if (!existsSync(join(profile,'package.json'))) execFileSync(process.execPath,[cli,'--profile','translation-smoke','--from-default-profile','web','--dump-config'],{env,stdio:['ignore','ignore','pipe'],timeout:60000})
const pluginDir = join(profile,'node_modules/dsh-prompt-translation')
await mkdir(pluginDir,{recursive:true})
execFileSync('tar',['-xzf',tarball,'--strip-components=1','-C',pluginDir])
const manifest = JSON.parse(await readFile(join(profile,'package.json'),'utf8'))
manifest.dependencies['dsh-prompt-translation'] = `file:${tarball}`
manifest.dsh.profile.bundles = [...new Set([...manifest.dsh.profile.bundles, 'dsh-prompt-translation'])]
await writeFile(join(profile,'package.json'),JSON.stringify(manifest,null,2))
await copyFile('scripts/full-host-fixture.mjs',join(root,'model.mjs'))
const callsPath = join(root,'model-calls.jsonl')
await writeFile(callsPath,'')
await writeFile(join(profile,'cordis.patch.yml'),stringify([
 {id:'workspace-controller',config:{documentsDirectory:join(root,'documents')}},
 {id:'agent-default-model',config:{provider:'translation-smoke',model:'main'}},
 {id:'prompt-translation',config:{enabled:false,type:'agent',provider:'translation-smoke',model:'translator',userPrompt:true,reasoning:true,output:true,source:'auto',target:'ja'}},
 {insert:[{id:'translation-smoke-model',name:pathToFileURL(join(root,'model.mjs')).href,config:{log:callsPath}}]},
]))
const port = 0
let output = ''
const host = spawn(process.execPath,[cli,'--profile','translation-smoke','--no-open','--port',String(port)],{env,stdio:['ignore','pipe','pipe']})
host.stdout.on('data',d=>{output+=d});host.stderr.on('data',d=>{output+=d})
let browser
const errors=[];const resources=[]
let page
let stage = 'startup and settings'
const wait = ms=>new Promise(r=>setTimeout(r,ms))
async function dismiss(target=page) {
 for(let n=0;n<5;n++) {
  for(const name of ['Continue','Configure later']) {
   const button=target.getByRole('button',{name,exact:true})
   if(await button.isVisible().catch(()=>false)) await button.click({timeout:1500}).catch(()=>{})
  }
  await wait(200)
 }
}
try {
 for(let n=0;n<120 && !output.includes('?token=');n++){if(host.exitCode!==null)throw Error(`Host exit ${host.exitCode}`);await wait(250)}
 const url=output.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/)?.[0]
 if(!url)throw Error('Host URL missing')
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'/usr/bin/google-chrome',headless:true,channel:process.env.CHROME_CHANNEL||undefined,args:['--no-sandbox','--disable-dev-shm-usage']})
 page=await browser.newPage({viewport:{width:1400,height:1050}})
 page.setDefaultTimeout(12000)
 page.on('pageerror',e=>errors.push(e.message))
 page.on('response',r=>{if(r.url().includes('dsh-prompt-translation'))resources.push({path:new URL(r.url()).pathname,status:r.status()})})
 await page.goto(url)
 await wait(1500);await dismiss()
 const expectedIcon=`data:image/svg+xml;base64,${(await readFile('icon.svg')).toString('base64')}`
 const checkIcon=async selector=>{
  const image=page.locator(`${selector} img`).first()
  await image.waitFor()
  assert.equal(await image.getAttribute('src'),expectedIcon)
  await image.evaluate(async node=>{await node.decode()})
  assert.ok(await image.evaluate(node=>node.naturalWidth>0))
 }
 await page.getByRole('button',{name:'Plugins',exact:true}).click()
 await checkIcon('[data-plugin-package="dsh-prompt-translation"]')
 await page.getByRole('button',{name:'View dsh-prompt-translation',exact:true}).click()
 await checkIcon('[data-plugin-detail]')
 await page.getByRole('heading',{name:'提示词与输出翻译'}).waitFor()
 const settingsCard=page.locator('.dsh-pt-card')
 assert.equal(await settingsCard.locator('form').isVisible(),true)
 assert.equal(await settingsCard.locator('.dsh-pt-card-header button').count(),0)
 await settingsCard.locator('.dsh-pt-card-header').click()
 assert.equal(await settingsCard.locator('form').isVisible(),true)

 assert.match(await page.locator('body').innerText(),/Running/)
 await page.getByLabel('原始语言',{exact:true}).selectOption('ja')
 await page.getByRole('button',{name:'保存设置',exact:true}).click()
 await wait(400)
 for (let attempt = 0; ; attempt++) {
  const saved = parse(await readFile(storePath,'utf8'))
  if (saved.source === 'ja') break
  if (attempt === 40) throw new Error('Settings were not persisted')
  await wait(100)
 }
 await page.screenshot({path:join(root,'settings.png'),fullPage:true})
 await page.reload();await wait(1500);await dismiss()
 await page.getByRole('button',{name:'Plugins',exact:true}).click()
 const entry=page.getByRole('button',{name:'View dsh-prompt-translation',exact:true})
 await entry.click()
 await page.waitForFunction(()=>document.querySelector('select[aria-label="原始语言"]')?.value==='ja')
 await page.getByRole('button',{name:'New session',exact:true}).first().click()
 await wait(1000);await dismiss()
 await writeFile(join(root,'before-turn.txt'),await page.locator('body').innerText())
 const quick=page.getByRole('button',{name:'翻译',exact:true})
 await quick.waitFor()
 await quick.click()
 const dialog=page.getByRole('dialog',{name:'快捷翻译设置'})
 await dialog.getByLabel('原始语言',{exact:true}).selectOption('auto')
 assert.equal(await quick.getAttribute('data-enabled'),'false')
 await dialog.getByLabel('启用翻译').click()
 await page.waitForFunction(()=>document.querySelector('button[aria-label="翻译"]')?.getAttribute('data-enabled')==='true')
 assert.equal(await dialog.locator('.dsh-pt-scope').count(),0)
 const position=await page.evaluate(()=>{
  const p=document.querySelector('[data-slot="conversation.input.permission"] button')?.getBoundingClientRect()
  const t=document.querySelector('button[aria-label="翻译"]')?.getBoundingClientRect()
  const plan=document.querySelector('[data-slot="conversation.input.plan"] button')?.getBoundingClientRect()
  return {permissionRight:p?.right,translationLeft:t?.left,translationRight:t?.right,planLeft:plan?.left}
 })
 assert.ok(position.translationLeft>=position.permissionRight)
 if(position.planLeft!==undefined)assert.ok(position.translationRight<=position.planLeft)
 await page.keyboard.press('Escape')
 const editor=page.locator('[contenteditable="true"]').first()
 stage = 'first turn'
 await editor.fill('测试消息 SMOKE_USER')
 await page.getByRole('button',{name:'Send message',exact:true}).click()
 await page.getByText('中文:SMOKE_ANSWER',{exact:false}).first().waitFor({timeout:25000})
 await waitForCompletedTurns(page, 1)
 await writeFile(join(root,'after-turn.txt'),await page.locator('body').innerText())
 await page.getByText('测试消息 SMOKE_USER',{exact:true}).waitFor({timeout:3000})
 await page.screenshot({path:join(root,'conversation.png'),fullPage:true})
 await quick.click()
 await dialog.getByLabel('目标语言',{exact:true}).selectOption('en')
 await page.waitForFunction(()=>document.querySelector('select[aria-label="目标语言"]')?.value==='en' && !document.querySelector('select[aria-label="目标语言"]')?.disabled)
 await page.keyboard.press('Escape')
 stage = 'second turn'
 await editor.fill('第二条 SMOKE_USER_2')
 await page.getByRole('button',{name:'Send message',exact:true}).click()
 await page.getByText('第二条 SMOKE_USER_2',{exact:true}).first().waitFor({timeout:25000})
 // Both fixture replies have the same text: the first reply cannot satisfy this wait.
 await page.getByText('中文:SMOKE_ANSWER',{exact:true}).nth(1).waitFor({timeout:25000})
 await waitForCompletedTurns(page, 2)
 stage = 'reload completed conversation'
 await page.reload(); await wait(1500); await dismiss()
 await page.getByText('第二条 SMOKE_USER_2',{exact:true}).first().waitFor()
 await waitForCompletedTurns(page, 2)
 stage = 'second conversation remains disabled'
 const callsBeforeB=(await readFile(callsPath,'utf8')).trim().split('\n').filter(Boolean).length
 const secondPage=await browser.newPage({viewport:{width:1400,height:1050}})
 secondPage.setDefaultTimeout(12000)
 secondPage.on('pageerror',e=>errors.push(e.message))
 secondPage.on('response',r=>{if(r.url().includes('dsh-prompt-translation'))resources.push({path:new URL(r.url()).pathname,status:r.status()})})
 await secondPage.goto(url)
 await wait(1500);await dismiss(secondPage)
 await secondPage.getByRole('button',{name:'New session',exact:true}).first().click()
 await wait(1000);await dismiss(secondPage)
 const secondQuick=secondPage.getByRole('button',{name:'翻译',exact:true})
 await secondQuick.waitFor()
 assert.equal(await secondQuick.getAttribute('data-enabled'),'false')
 await secondQuick.click()
 const secondDialog=secondPage.getByRole('dialog',{name:'快捷翻译设置'})
 assert.equal(await secondDialog.getByLabel('启用翻译').isChecked(),false)
 assert.equal(await secondDialog.locator('.dsh-pt-scope').count(),0)
 await secondPage.keyboard.press('Escape')
 await secondPage.locator('[contenteditable="true"]').first().fill('未翻译 SMOKE_RAW')
 await secondPage.getByRole('button',{name:'Send message',exact:true}).click()
 await secondPage.getByText('SMOKE_ANSWER',{exact:false}).first().waitFor({timeout:25000})
 await waitForCompletedTurns(secondPage,1)
 assert.equal(await secondPage.getByText('中文:SMOKE_ANSWER',{exact:false}).count(),0)
 await secondPage.screenshot({path:join(root,'second-conversation-untranslated.png'),fullPage:true})
 const bCalls=(await readFile(callsPath,'utf8')).trim().split('\n').filter(Boolean).slice(callsBeforeB).map(line=>JSON.parse(line))
 const bMain=bCalls.find(call=>call.model==='main'&&call.loop)
 assert.ok(bMain)
 assert.ok(bMain.sessionId)
 assert.ok(bMain.messages.some(m=>m.role==='user'&&m.content.some(b=>b.text==='未翻译 SMOKE_RAW')))
 assert.equal(bCalls.filter(call=>call.model==='translator').length,0)
 const aMain=(await readFile(callsPath,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)).find(call=>call.model==='main'&&call.loop)
 assert.notEqual(bMain.sessionId,aMain.sessionId)
 await quick.click()
 assert.equal(await quick.getAttribute('data-enabled'),'true')
 assert.equal(await dialog.getByLabel('目标语言',{exact:true}).inputValue(),'en')
 assert.equal(await dialog.locator('.dsh-pt-scope').count(),0)
 await page.keyboard.press('Escape')
 stage = 'trajectory comparisons'
 await page.getByRole('tab',{name:'Trajectory',exact:true}).click()
 await wait(500)
 await page.locator('tr[data-kind="user"]').last().click()
 await page.getByRole('tab',{name:'Preview',exact:true}).click()
 const preview=await page.locator('#trajectory-detail-panel').innerText()
 assert.ok(preview.includes('第二条 SMOKE_USER_2') && preview.includes('English:第二条 SMOKE_USER_2'))
 await page.screenshot({path:join(root,'trajectory-preview.png'),fullPage:true})
 await page.getByRole('tab',{name:'Raw',exact:true}).click()
 const raw=await page.locator('#trajectory-detail-panel').innerText()
 assert.ok(raw.includes('第二条 SMOKE_USER_2') && raw.includes('English:第二条 SMOKE_USER_2'))
 assert.equal((raw.match(/Block #\d+ text/g) ?? []).length, 1, 'User comparison should occupy one text block')
 await page.screenshot({path:join(root,'trajectory-raw.png'),fullPage:true})
 await writeFile(join(root,'trajectory-dom.txt'),await page.locator('body').innerText())
 await page.screenshot({path:join(root,'trajectory.png'),fullPage:true})
 await page.locator('tr[data-kind="message"]').last().click()
 await page.getByRole('tab',{name:'Preview',exact:true}).click()
 const thinking = page.locator('#trajectory-detail-panel button[aria-expanded="false"]')
 if (await thinking.count()) await thinking.first().click()
 const assistantPreview = await page.locator('#trajectory-detail-panel').innerText()
 for (const text of ['翻译前 / Original', '翻译后 / Translation', 'SMOKE_ANSWER', '中文:SMOKE_ANSWER', 'SMOKE_THINK', '中文:SMOKE_THINK']) assert.ok(assistantPreview.includes(text), `Assistant preview missing ${text}`)
 await page.screenshot({path:join(root,'assistant-preview.png'),fullPage:true})
 await page.getByRole('tab',{name:'Raw',exact:true}).click()
 const assistantRaw = await page.locator('#trajectory-detail-panel').innerText()
 for (const text of ['翻译前 / Original', '翻译后 / Translation', 'SMOKE_ANSWER', '中文:SMOKE_ANSWER', 'SMOKE_THINK', '中文:SMOKE_THINK']) assert.ok(assistantRaw.includes(text), `Assistant raw missing ${text}`)
 await page.screenshot({path:join(root,'assistant-raw.png'),fullPage:true})
 await page.getByRole('tab',{name:'Chat',exact:true}).click()
 assert.equal(await page.getByText('翻译前 / Original',{exact:false}).count(), 0)
 // Translation errors retain the submitted text and never call the main model.
 stage = 'translation failure'
 const beforeFailure=(await readFile(callsPath,'utf8')).trim().split('\n').map(line=>JSON.parse(line)).filter(call=>call.model==='main').length
 await page.locator('[contenteditable="true"]').first().fill('FAIL_TRANSLATION')
 await page.getByRole('button',{name:'Send message',exact:true}).click()
 await page.getByText('FAIL_TRANSLATION',{exact:true}).waitFor({timeout:25000})
 await wait(800)
 const failedCalls=(await readFile(callsPath,'utf8')).trim().split('\n').map(line=>JSON.parse(line)).filter(call=>call.model==='main').length
 assert.equal(failedCalls,beforeFailure)
 await page.screenshot({path:join(root,'translation-failure.png'),fullPage:true})

 const calls=(await readFile(callsPath,'utf8')).trim().split('\n').map(line=>JSON.parse(line))
 const main=calls.find(call=>call.model==='main')
 const second=calls.filter(call=>call.model==='main'&&call.loop)[1]
 assert.ok(second.messages.some(m=>m.role==='user'&&m.content.some(b=>b.text==='English:第二条 SMOKE_USER_2')))
 assert.ok(!second.messages.some(m=>m.role==='user'&&m.content.some(b=>b.text==='日本語:第二条 SMOKE_USER_2')))
 assert.ok(main)
 assert.notEqual(main.sessionId,bMain.sessionId)
 assert.ok(main.messages.some(m=>m.role==='user'&&m.content.some(b=>b.text?.includes('日本語:测试消息 SMOKE_USER'))))
 assert.ok(calls.some(call=>call.model==='translator'&&call.system?.includes('to 简体中文.')&&call.messages.some(m=>m.content.some(b=>b.text==='SMOKE_THINK'))))
 assert.ok(calls.some(call=>call.model==='translator'&&call.system?.includes('to 简体中文.')&&call.messages.some(m=>m.content.some(b=>b.text==='SMOKE_ANSWER'))))
 assert.ok(!calls.filter(call=>call.model==='translator').some(call=>call.messages.some(m=>m.role==='system')))
 const savedConfig=parse(await readFile(storePath,'utf8'))
 assert.equal(savedConfig.enabled,false)
 assert.equal(savedConfig.sessionOverrides[main.sessionId].enabled,true)
 assert.equal(savedConfig.sessionOverrides[main.sessionId].target,'en')
 assert.equal(savedConfig.sessionOverrides[bMain.sessionId],undefined)
 assert.equal((await stat(storePath)).mode & 0o777,0o600)
 const profileConfig=parse(await readFile(join(profile,'cordis.patch.yml'),'utf8')).find(row=>row.id==='prompt-translation').config
 assert.equal(profileConfig.enabled,false)
 assert.equal(profileConfig.source,'auto')
 assert.equal(profileConfig.sessionOverrides,undefined)
 assert.deepEqual(errors,[])
 assert.ok(resources.some(r=>r.status===200))
 const result={version,result:'pass',checks:['exact published CLI','isolated complete Web Profile cold start','plugin Running','manifest SVG icon decoded on plugin card and detail','settings card fixed expanded on the real Plugins page','independent YAML settings persisted and reload verified; no Profile user writes','composer placement','quick setting scoped to the first conversation','complete user turn','forward Japanese / return Chinese','target switches from Japanese to English','chat displays original Chinese','trajectory Preview and Raw contain original and sent translation','assistant reasoning and output comparisons survive reload in Preview and Raw','chat answer stays translated without comparison labels','two user turns visible','user message and per-session settings survive reload', 'second conversation stays disabled with no translator call', 'Profile scope footer removed','failed translation retains original and blocks main model','no page errors'],position,resources,modelCalls:calls.length,limitation:'Deterministic external model; no credentialed provider or translation quality validation'}
 await writeFile(join(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))
}catch(error){
 const state = await page?.evaluate(hostTurnDiagnostics).catch(()=>undefined)
 console.error('Full-host smoke failed:', JSON.stringify({version,stage,state}))
 await writeFile(join(root,'result.json'),JSON.stringify({version,result:'fail',stage,state,error:String(error),errors,resources},null,2))
 if(page){await writeFile(join(root,'failure-dom.txt'),await page.locator('body').innerText().catch(()=>''));await page.screenshot({path:join(root,'failure.png'),fullPage:true}).catch(()=>{})}
 throw error
}finally{
 await writeFile(join(root,'host.log'),output.replace(/\?token=\S+/g,'?token=[redacted]'))
 await browser?.close();host.kill('SIGTERM')
 await Promise.race([new Promise(r=>host.once('exit',r)),wait(2000)])
 if(host.exitCode===null)host.kill('SIGKILL')
}
