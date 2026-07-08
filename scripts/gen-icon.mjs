// Render the app icon PNG from the source logo using Electron (no external
// image tooling). Cover-crops the droplet into a rounded 512px tile with
// transparent corners. Usage: node_modules/.bin/electron scripts/gen-icon.mjs
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const assets = path.join(dir, '..', 'app', 'renderer', 'assets');
const size = 512;

const jpg = fs.readFileSync(path.join(assets, 'logo-source.jpg')).toString('base64');
const src = `data:image/jpeg;base64,${jpg}`;

const html = `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;width:${size}px;height:${size}px;background:transparent;overflow:hidden}
  .tile{width:${size}px;height:${size}px;border-radius:112px;
    background-image:url('${src}');background-size:cover;background-position:center 44%}
</style><div class="tile"></div>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: size,
    height: size,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
  });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 400));
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(assets, 'icon.png'), image.toPNG());
  console.log('wrote icon.png', image.getSize());
  app.quit();
});
