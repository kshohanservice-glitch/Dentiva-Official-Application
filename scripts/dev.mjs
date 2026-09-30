/* Dev orchestrator: vite dev server + main/preload watch + electron launch. */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(root, '..');
const children = [];

function run(name, cmd, args, env = {}) {
  const child = spawn(cmd, args, {
    cwd: repo,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.stdout.write(`[${name}] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[${name}] ${d}`));
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[${name}] exited with ${code}`);
      shutdown(code);
    }
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  for (const c of children) {
    try {
      c.kill('SIGTERM');
    } catch {}
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// 1. build main+preload once, then watch
run('main-build', process.execPath, [path.join(root, 'build-main.cjs')]);

// 2. vite dev server
run('vite', 'npx', ['vite', '--port', '5173', '--strictPort']);

// 3. electron (waits a moment for vite)
setTimeout(() => {
  run('electron', 'npx', ['electron', '.', '--dev'], { VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173' });
}, 3000);

// keep main rebuild watch alive via esbuild context would be nicer; rebuild on change:
import fs from 'node:fs';
let rebuildTimer = null;
const watchDirs = [path.join(repo, 'src/main'), path.join(repo, 'src/preload'), path.join(repo, 'src/shared')];
function watchAll(dir) {
  try {
    fs.watch(dir, { recursive: true }, () => {
      clearTimeout(rebuildTimer);
      rebuildTimer = setTimeout(() => {
        const c = spawn(process.execPath, [path.join(root, 'build-main.cjs')], { cwd: repo, stdio: 'inherit' });
        c.on('exit', () => console.log('[main-build] rebuilt'));
      }, 300);
    });
  } catch {}
}
watchDirs.forEach(watchAll);
