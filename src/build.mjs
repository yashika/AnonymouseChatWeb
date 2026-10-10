/*!
 * Build the single-file app.
 * 构建单文件网页：把 i18n.js / core.js / app.js 内联进模板，输出到仓库根目录的 index.html
 * （GitHub Pages 会直接把根目录的 index.html 作为站点首页。）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const tpl = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');
const parts = [
  ['i18n', fs.readFileSync(path.join(__dirname, 'i18n.js'), 'utf8')],
  ['core', fs.readFileSync(path.join(__dirname, 'core.js'), 'utf8')],
  ['app', fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8')]
];

for (const [name, code] of parts) {
  if (code.includes('</script')) throw new Error(`${name}.js contains </script and cannot be inlined`);
}

let out = tpl;
for (const [name, code] of parts) {
  const marker = `<!-- @@${name.toUpperCase()}@@ -->`;
  if (!out.includes(marker)) throw new Error(`template is missing ${marker}`);
  out = out.replace(marker, `<script>\n${code}\n</script>`);
}

const target = path.join(root, 'index.html');
fs.writeFileSync(target, out, 'utf8');
console.log('built', target, `(${(out.length / 1024).toFixed(1)} KB)`);
