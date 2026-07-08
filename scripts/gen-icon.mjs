// Render the logo SVG to a PNG app icon using Electron (no external SVG tooling).
// Usage: node_modules/.bin/electron scripts/gen-icon.mjs
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const assets = path.join(dir, '..', 'app', 'renderer', 'assets');
const size = 512;

const svg = fs
  .readFileSync(path.join(assets, 'logo.svg'), 'utf8')
  .replace('width="48" height="48"', `width="${size}" height="${size}"`);

const html = `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;width:${size}px;height:${size}px;background:transparent;overflow:hidden}
  svg{width:${size}px;height:${size}px;display:block}
</style>${svg}`;

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
  const out = path.join(assets, 'icon.png');
  fs.writeFileSync(out, image.toPNG());
  console.log('wrote', out, image.getSize());
  app.quit();
});
