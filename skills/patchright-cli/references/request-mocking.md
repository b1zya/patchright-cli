# Request mocking

Intercept, mock, modify and block network requests.

## What it costs on protected pages

Patchright already intercepts every request (that is how it injects scripts), so a route adds no new protocol leak. It does change what the site observes: while any route is installed the browser cache is disabled (`route-cache`), a mocked response is a different response, and a route matching documents shadows init-script injection when init scripts are configured (`route-shadows-init`). Mock narrowly (`**/api/users`, not `**/*`) and remove routes when done. `--remove-header=cookie` logs the identity out of everything it matches.

## Route commands

```bash
patchright-cli route "**/*.jpg" --status=404
patchright-cli route "**/api/users" --body='[{"id":1,"name":"Alice"}]' --content-type=application/json
patchright-cli route "**/api/data" --body='{"ok":true}' --header="X-Custom: value"
patchright-cli route "**/api/*" --remove-header=x-debug
patchright-cli route-list
patchright-cli unroute "**/*.jpg"
patchright-cli unroute            # removes every route installed with `route`
```

`unroute` only removes routes you installed; Patchright's own injection route is untouched. In `run-code`, use `page.unroute(pattern, handler)` — `unrouteAll()` is refused because it would remove the injection route.

## URL patterns

```
**/api/users           exact path
**/api/*/details       wildcard in the path
**/*.{png,jpg,jpeg}    file extensions
**/search?q=*          query parameters
```

## Advanced mocking with run-code

### Conditional response

```bash
patchright-cli run-code "async page => {
  await page.route('**/api/login', route => {
    const body = route.request().postDataJSON();
    if (body.username === 'admin')
      return route.fulfill({ body: JSON.stringify({ token: 'mock-token' }) });
    return route.fulfill({ status: 401, body: JSON.stringify({ error: 'Invalid' }) });
  });
}"
```

### Modify a real response

```bash
patchright-cli run-code "async page => {
  await page.route('**/api/user', async route => {
    const response = await route.fetch();
    const json = await response.json();
    json.isPremium = true;
    await route.fulfill({ response, json });
  });
}"
```

### Simulate failures and slow networks

```bash
patchright-cli run-code "async page => page.route('**/api/offline', route => route.abort('internetdisconnected'))"
patchright-cli run-code "async page => {
  await page.route('**/api/slow', async route => {
    await new Promise(r => setTimeout(r, 3000));
    await route.fulfill({ body: JSON.stringify({ data: 'loaded' }) });
  });
}"
patchright-cli network-state-set offline
patchright-cli network-state-set online
```

### Remove a route from run-code

```bash
patchright-cli run-code "async page => {
  const handler = route => route.continue();
  await page.route('**/api/*', handler);
  // ...
  await page.unroute('**/api/*', handler);
}"
```

## Inspecting traffic

```bash
patchright-cli requests
patchright-cli request 5
patchright-cli request-headers 5
patchright-cli request-body 5
patchright-cli response-headers 5
patchright-cli response-body 5     # binary bodies are saved to a file
```
