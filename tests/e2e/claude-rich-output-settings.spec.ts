import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

test.use({ launchEnv: { ORCA_BACKGROUND_LAUNCH: '1' } })
test('Claude rich output is opt-in and persists independently of inline images', async ({
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  await orcaPage.evaluate(async () => {
    const state = window.__store!.getState()
    await state.updateSettings({ uiLanguage: 'en', theme: 'light' })
    state.openSettingsTarget({ pane: 'terminal', repoId: null })
    state.openSettingsPage()
  })
  const toggle = orcaPage.getByRole('switch', { name: 'Claude Rich Output', exact: true })
  await toggle.scrollIntoViewIfNeeded()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle
    .locator('..')
    .locator('..')
    .screenshot({ path: testInfo.outputPath('rich-output-off.png'), animations: 'disabled' })
  await toggle.click()
  await expect
    .poll(async () => (await orcaPage.evaluate(() => window.api.settings.get())).claudeRichOutput)
    .toBe(true)
  await toggle
    .locator('..')
    .locator('..')
    .screenshot({ path: testInfo.outputPath('rich-output-on.png'), animations: 'disabled' })
  await orcaPage.reload()
  await waitForSessionReady(orcaPage)
  expect((await orcaPage.evaluate(() => window.api.settings.get())).claudeRichOutput).toBe(true)
  await orcaPage.evaluate(() =>
    window.__store!.getState().updateSettings({ claudeRichOutput: false })
  )
  expect((await orcaPage.evaluate(() => window.api.settings.get())).terminalInlineImages).toBe(true)
})
