import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
await build({ entryPoints: ['scripts/browser-fixture.tsx'], outfile: 'artifacts/browser-fixture.js', bundle: true, platform: 'browser', format: 'iife', jsx: 'transform', define: { 'process.env.NODE_ENV': '"development"' } })
const server = createServer(async (req, res) => {
  if (req.url === '/fixture.js' || req.url === '/client.js') {
    res.setHeader('Content-Type', 'text/javascript')
    res.end(await readFile(req.url === '/fixture.js' ? 'artifacts/browser-fixture.js' : 'lib/client.js'))
  } else res.end(`<!doctype html><html lang="zh"><meta charset="utf-8"><title>Translation browser fixture</title><style>body{font:14px system-ui;margin:30px;background:#171a20;color:#e5e7eb}#composer{margin-top:300px;padding:20px;border:1px solid #555;border-radius:14px;display:flex;align-items:center}#modes{display:flex;gap:8px;align-items:center}button{cursor:pointer} [data-slot]{display:contents}</style><h1>提示词翻译 0.1.0</h1><div data-slot="plugins.bundle.config"></div><div id="composer"><div id="modes"><div data-slot="conversation.input.permission"><button>权限</button></div><div data-slot="conversation.input.plan"><button>计划</button></div></div><div data-slot="conversation.input.left"></div></div><script src="/fixture.js"></script><script src="/client.js"></script></html>`)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, channel: process.env.CHROME_CHANNEL || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const page = await browser.newPage({ viewport: { width: 1100, height: 1100 } })
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByRole('button', { name: '翻译', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '快捷翻译设置' })
  await dialog.getByLabel('原始语言').selectOption('ja')
  await dialog.getByLabel('目标语言').selectOption('zh')
  await dialog.getByLabel('启用翻译').check()
  assert.equal(await page.evaluate(() => window.fixtureState.source), 'auto')
  assert.equal(await page.evaluate(() => window.fixtureState.target), 'en')
  assert.equal(await page.evaluate(() => window.fixtureState.enabled), false)
  assert.equal(await page.evaluate(() => window.fixtureState.sessionOverrides['browser-session'].source), 'ja')
  assert.equal(await page.evaluate(() => window.fixtureState.sessionOverrides['browser-session'].target), 'zh')
  assert.equal(await page.evaluate(() => window.fixtureState.sessionOverrides['browser-session'].enabled), true)
  assert.equal(await dialog.locator('.dsh-pt-scope').count(), 0)
  const position = await page.evaluate(() => {
    const permission = document.querySelector('[data-slot="conversation.input.permission"] button').getBoundingClientRect()
    const translation = document.querySelector('button[aria-label="翻译"]').getBoundingClientRect()
    const plan = document.querySelector('[data-slot="conversation.input.plan"] button').getBoundingClientRect()
    return { permission: permission.right, translation: translation.left, translationRight: translation.right, plan: plan.left }
  })
  assert.ok(position.translation >= position.permission)
  assert.ok(position.translationRight <= position.plan)
  assert.equal(await page.getByRole('button', { name: '翻译', exact: true }).innerText(), '')
  const languages = await dialog.locator('select').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { top: r.top, right: r.right, left: r.left } }))
  assert.equal(languages[0].top, languages[1].top)
  assert.ok(languages[0].right < languages[1].left)
  await page.screenshot({ path: 'artifacts/browser-desktop.png', fullPage: true })
  await page.keyboard.press('Escape')
  await page.getByLabel('翻译类型').selectOption('agent')
  await page.getByLabel('提供商 ID').fill('existing-provider')
  await page.getByLabel('模型 ID').fill('existing-model')
  await page.getByLabel('推理强度（留空使用模型默认值）').fill('low')
  await page.getByRole('button', { name: '保存设置' }).click()
  await page.waitForFunction(() => window.fixtureState.type === 'agent')
  assert.equal(await page.evaluate(() => window.fixtureState.reasoningEffort), 'low')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '翻译', exact: true }).click()
  await page.screenshot({ path: 'artifacts/browser-mobile.png', fullPage: true })
  await page.evaluate(() => window.disposeFixture())
  assert.equal(await page.locator('.dsh-pt-seat').count(), 0)
  assert.equal(await page.locator('style[data-dsh-prompt-translation]').count(), 0)
  assert.deepEqual(errors, [])
  const result = { result: 'pass', browser: await browser.version(), position, pageErrors: errors, checks: ['built module-loader bundle', 'permission < translation < plan', 'per-session quick persistence without Profile quick writes', 'agent settings persistence', 'Profile scope footer removed', 'mobile viewport', 'unload cleanup'], limitation: 'Isolated browser fixture with host-compatible slot wrappers and settings Remote; not full DSH Web application' }
  await writeFile('artifacts/browser-result.json', JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)) }
