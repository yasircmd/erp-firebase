// The in-app dialogs (public/index.html, APP DIALOGS) for UI tests, in the
// shape of Playwright's page.on('dialog'):
//   await onAppDialog(page, d => { log.push(d.message()); d.accept(); });
// d: type() ('alert' | 'confirm' | 'prompt'), message(), defaultValue(),
// accept(text?) and dismiss(), which answer by typing into and clicking the
// dialog's own controls. Call it before page.goto.
// A browser popup is never expected any more: one is dismissed and recorded
// as an error in opts.errors, else page.__errors (set it before calling),
// which the tests assert stay empty.
async function onAppDialog(page, handler, opts) {
  page.on('dialog', d => {
    d.dismiss().catch(() => {});
    const errors = (opts && opts.errors) || page.__errors;
    if (errors) errors.push('browser popup: ' + d.type() + ': ' + d.message());
    else throw new Error('browser popup: ' + d.type() + ': ' + d.message());
  });
  await page.exposeBinding('__onAppDialog', (_source, detail) => {
    const answer = async (ok, text) => {
      if (ok && detail.type === 'prompt' && text !== undefined) {
        await page.fill('#app-dialog-input:visible, #app-dialog-textarea:visible', String(text));
      }
      await page.click(ok ? '#app-dialog-ok' : '#app-dialog-cancel');
    };
    // Not awaited here: the handler may itself wait on the page.
    Promise.resolve().then(() => handler({
      type: () => detail.type,
      message: () => detail.message,
      defaultValue: () => detail.defaultValue,
      accept: text => answer(true, text),
      dismiss: () => answer(false)
    })).catch(() => {});
  });
  await page.addInitScript(() => {
    window.addEventListener('app-dialog', e => window.__onAppDialog(e.detail));
  });
}

module.exports = { onAppDialog };
