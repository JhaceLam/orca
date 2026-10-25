import { writeFileSync } from 'node:fs'
import type { Page } from '@stablyai/playwright-test'
import { PNG } from 'pngjs'
import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForSessionReady } from './helpers/store'
import {
  execInTerminal,
  waitForActiveTerminalManager,
  waitForPaneIdentitySnapshot,
  waitForTerminalOutput
} from './helpers/terminal'
import { enableInlineImages, inlineImagePayload } from './helpers/terminal-inline-image-proof'
import { nodeTerminalCommand } from './terminal-node-command'

test.use({
  launchEnv: { ORCA_BACKGROUND_LAUNCH: '1' },
  orcaAppExtraArgs: ['--force-color-profile=srgb']
})

async function orangeImagePixels(page: Page, screenshotPath: string): Promise<number> {
  const png = PNG.sync.read(
    await page.locator('.pane:visible .xterm-screen').first().screenshot({ path: screenshotPath })
  )
  let orange = 0
  for (let i = 0; i < png.data.length; i += 4) {
    if (
      png.data[i]! > 220 &&
      png.data[i + 1]! > 130 &&
      png.data[i + 1]! < 190 &&
      png.data[i + 2]! < 60
    ) {
      orange++
    }
  }
  return orange
}

for (const selector of ['i', 'I']) {
  test(`named physical Kitty placement disappears on d=${selector}`, async ({
    orcaPage
  }, testInfo) => {
    await waitForSessionReady(orcaPage)
    await ensureTerminalVisible(orcaPage)
    await waitForActiveTerminalManager(orcaPage)
    await enableInlineImages(orcaPage)
    const identity = await waitForPaneIdentitySnapshot(orcaPage, 1)
    const ptyId = identity.panes[0]?.ptyId
    if (!ptyId) {
      throw new Error('Missing test PTY')
    }
    const png = new PNG({ width: 120, height: 36 })
    for (let i = 0; i < png.data.length; i += 4) {
      png.data.set([240, 160, 40, 255], i)
    }
    const producer = testInfo.outputPath('named-physical-image.cjs')
    writeFileSync(
      producer,
      "process.stdout.write(Buffer.from(process.argv[2], 'base64')); console.log('NAMED_PHYSICAL_' + process.argv[3])"
    )
    const image = `\x1b_Ga=T,f=100,i=77,p=10,q=2;${PNG.sync.write(png).toString('base64')}\x1b\\`
    await execInTerminal(
      orcaPage,
      ptyId,
      nodeTerminalCommand([producer, Buffer.from(image).toString('base64'), 'SHOWN'])
    )
    await waitForTerminalOutput(orcaPage, 'NAMED_PHYSICAL_SHOWN')
    await expect
      .poll(() => orangeImagePixels(orcaPage, testInfo.outputPath('before-delete.png')))
      .toBeGreaterThan(1000)

    const deletion = `\x1b_Ga=d,d=${selector},i=77,p=10,q=2;\x1b\\`
    await execInTerminal(
      orcaPage,
      ptyId,
      nodeTerminalCommand([producer, Buffer.from(deletion).toString('base64'), 'DELETED'])
    )
    await waitForTerminalOutput(orcaPage, 'NAMED_PHYSICAL_DELETED')
    await expect
      .poll(() => orangeImagePixels(orcaPage, testInfo.outputPath('after-delete.png')))
      .toBeLessThan(50)
  })
}

test('Kitty Unicode images survive renderer reload without producer retransmission', async ({
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await waitForActiveTerminalManager(orcaPage)
  await enableInlineImages(orcaPage)
  const identity = await waitForPaneIdentitySnapshot(orcaPage, 1)
  const ptyId = identity.panes[0]?.ptyId
  if (!ptyId) {
    throw new Error('Missing test PTY')
  }
  const cachedImages = () =>
    orcaPage.evaluate(async () => {
      const db = await new Promise<IDBDatabase | null>((resolve) => {
        const request = indexedDB.open('orca-terminal-kitty-replay')
        request.onupgradeneeded = () => request.transaction?.abort()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => resolve(null)
      })
      if (!db) {
        return 0
      }
      try {
        return await new Promise<number>((resolve, reject) => {
          const request = db.transaction('images').objectStore('images').count()
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
      } finally {
        db.close()
      }
    })
  expect(await cachedImages()).toBe(0)
  const producer = testInfo.outputPath('kitty-image.cjs')
  const payload = inlineImagePayload(true)
  const kittyOnly = `\x1bc${payload.slice(payload.indexOf('Kitty placeholders:'))}`
  writeFileSync(
    producer,
    `process.stdout.write(Buffer.from('${Buffer.from(kittyOnly).toString('base64')}', 'base64')); console.log('KITTY_REPLAY_' + 'READY')`
  )
  await execInTerminal(orcaPage, ptyId, nodeTerminalCommand([producer]))
  await waitForTerminalOutput(orcaPage, 'KITTY_REPLAY_READY')
  const imagePixels = (name: string) =>
    orangeImagePixels(orcaPage, testInfo.outputPath(`${name}.png`))
  await expect.poll(() => imagePixels('before-reload')).toBeGreaterThan(1000)
  await expect.poll(cachedImages).toBeGreaterThan(0)
  for (let attempt = 0; attempt < 3; attempt++) {
    await orcaPage.reload()
    await waitForSessionReady(orcaPage)
    await waitForActiveTerminalManager(orcaPage)
    await expect
      .poll(() => imagePixels(`after-reload-${attempt}`), { timeout: 30_000 })
      .toBeGreaterThan(1000)
    const restored = await waitForPaneIdentitySnapshot(orcaPage, 1)
    expect(restored.panes[0]?.ptyId).toBe(ptyId)
    await orcaPage.screenshot({
      path: testInfo.outputPath('review-proof.png'),
      clip: { x: 280, y: 20, width: 800, height: 85 }
    })
  }
})
