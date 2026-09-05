# Running custom code with `run-code`

Use `run-code` for scenarios the commands do not cover. The code is a single function expression invoked with `page` (Patchright's `Page`, the standard Playwright page API); `import`/`require` are not available.

```bash
patchright-cli run-code "async page => {
  // page, page.context(), page.mouse, page.keyboard, page.request ...
}"
patchright-cli run-code --filename=./my-script.js
```

## Patchright differences you must know

- **`page.evaluate` runs in an isolated world by default.** Page globals (`window.__STATE__`, framework instances) are invisible there; DOM access works. The fourth argument selects the page main world:

  ```bash
  patchright-cli run-code "async page => page.evaluate(() => window.__INITIAL_STATE__, undefined, undefined, false)"
  # the same for locators
  patchright-cli run-code "async page => page.locator('#app').evaluate(el => el.__vue_app__ !== undefined, undefined, undefined, false)"
  ```

  `eval --main-world` is the shorthand for expressions.
- **`page.on('console')` never fires.** Patchright removes `Runtime.enable`; there is no page console. Return values instead of logging them.
- **Refused code.** `unrouteAll()` (would remove the route Patchright injects scripts through), `Runtime.enable` (the primary leak) and `--enable-automation`. `--force` overrides the first and the last; nothing overrides `Runtime.enable`.
- **Warned code.** `addInitScript`, `exposeFunction`, `exposeBinding`, `clock.install` make Patchright rewrite every HTML document for the rest of the session (`init-script-route`); `setViewportSize`, `setUserAgent`, `setExtraHTTPHeaders`, `Emulation.*` add overrides Patchright does not hide (`run-code-emulation`). On protected pages, avoid them.
- **Locators work inside closed shadow roots**; XPath too.

## Waiting

```bash
patchright-cli run-code "async page => page.waitForLoadState('networkidle')"
patchright-cli run-code "async page => page.locator('.loading').waitFor({ state: 'hidden' })"
patchright-cli run-code "async page => page.waitForFunction(() => document.readyState === 'complete')"
patchright-cli run-code "async page => page.locator('.result').waitFor({ timeout: 10000 })"
```

## Frames

```bash
patchright-cli run-code "async page => {
  const frame = page.locator('iframe#my-iframe').contentFrame();
  await frame.locator('button').click();
}"
patchright-cli run-code "async page => page.frames().map(f => f.url())"
```

## Downloads

```bash
patchright-cli run-code "async page => {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('a.download').click(),
  ]);
  await download.saveAs('./report.pdf');
  return download.suggestedFilename();
}"
```

## Permissions and geolocation

Prefer `open --grant=...` and `--proxy` with geoip: they are applied at launch and recorded in the identity. Changing them mid-session is possible but visible as a change:

```bash
patchright-cli run-code "async page => page.context().grantPermissions(['clipboard-read'], { origin: 'https://example.com' })"
patchright-cli run-code "async page => page.context().setGeolocation({ latitude: 51.5074, longitude: -0.1278 })"
```

## Pointer and keyboard

The `click`/`fill`/`type` commands with `--humanize` already produce curved paths and typing cadence. In code, avoid instant `fill` on protected forms; use `pressSequentially` with a delay:

```bash
patchright-cli run-code "async page => {
  const box = page.getByRole('textbox', { name: 'Email' });
  await box.click();
  await box.pressSequentially('user@example.com', { delay: 90 });
}"
```

## Reading application state

```bash
patchright-cli --raw run-code "async page => page.evaluate(() => JSON.stringify(window.__APP__.cart), undefined, undefined, false)"
```

## Multiple pages and contexts

`page.context().pages()` lists the session's tabs; `page.context().newPage()` opens one (same identity). Do not create new browser contexts for other identities inside a session; use another session.

## Returning values

The function's return value is JSON-serialized into the response; with `--raw` only the value is printed. Return plain data, not handles.
