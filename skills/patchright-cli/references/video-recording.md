# Video recording

Capture a session as WebM for debugging, documentation or proof of work. Recording itself uses the screencast API and is not observable by the page; the overlays and chapter cards are DOM injected into the page (`highlight-dom`), so use them on your own pages or on demos, not on protected sites you are trying to stay unnoticed on.

## Basic recording

```bash
patchright-cli open https://example.com
patchright-cli video-start demo.webm
patchright-cli video-chapter "Getting started" --description="Opening the homepage" --duration=2000
patchright-cli snapshot
patchright-cli click e1
patchright-cli video-chapter "Filling the form" --description="Entering test data" --duration=2000
patchright-cli fill e2 "test input"
patchright-cli video-stop
```

Files land in the output directory (`.patchright-cli/`) unless the name is absolute.

## Annotating actions

```bash
# a callout naming each subsequent action and highlighting its target (DOM overlay)
patchright-cli video-show-actions --duration=600 --position=top-right
patchright-cli click e4
patchright-cli video-hide-actions
```

## Scripted "hero" recordings

For a polished video, script the scenario and run it with `run-code`: pauses, chapter cards and sticky annotations are available on `page.screencast`. Use `pressSequentially` with a delay for natural typing. Overlays are `pointer-events: none`, so they do not block interactions.

```js
async page => {
  await page.screencast.start({ path: 'video.webm', size: { width: 1280, height: 800 } });
  await page.goto('https://app.example/todos');

  await page.screencast.showChapter('Adding todo items', { description: 'We will add several items.', duration: 2000 });
  const input = page.getByRole('textbox', { name: 'What needs to be done?' });
  await input.pressSequentially('Walk the dog', { delay: 60 });
  await input.press('Enter');
  await page.waitForTimeout(1000);

  const note = await page.screencast.showOverlay(`
    <div style="position:absolute;top:8px;right:8px;padding:6px 12px;background:rgba(0,0,0,.7);border-radius:8px;font-size:13px;color:white">
      Item added
    </div>`);
  await input.pressSequentially('Buy groceries', { delay: 60 });
  await input.press('Enter');
  await page.waitForTimeout(1500);
  await note.dispose();

  const bounds = await page.getByText('Walk the dog').boundingBox();
  await page.screencast.showOverlay(`
    <div style="position:absolute;top:${bounds.y}px;left:${bounds.x}px;width:${bounds.width}px;height:${bounds.height}px;border:1px solid red"></div>`, { duration: 2000 });

  await page.screencast.stop();
}
```

```bash
patchright-cli run-code --filename=hero.js
```

| method | use |
|---|---|
| `page.screencast.showChapter(title, { description?, duration?, styleSheet? })` | full-screen chapter card with a blurred backdrop |
| `page.screencast.showOverlay(html, { duration? })` | custom HTML overlay; returns a disposable when no duration is given |
| `disposable.dispose()` | remove a sticky overlay |
| `page.screencast.hideOverlays()` / `showOverlays()` | temporarily hide or show all overlays |

## Video vs tracing

| | video | tracing |
|---|---|---|
| output | WebM | trace file for the Trace Viewer |
| shows | what the screen showed | DOM snapshots, network, actions |
| use | demos, documentation, proof of work | debugging |
| footprint on the page | overlays only | utility-world snapshots on every action (`tracing` warning) |
