import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const localGo = resolve(root, '.tools/go/bin', process.platform === 'win32' ? 'go.exe' : 'go');
const go = existsSync(localGo) ? localGo : 'go';
function run(command, args, cwd = root) {
  const env = { ...process.env };
  if (existsSync(localGo)) {
    env.GOCACHE = resolve(root, '.tools/go-cache');
    env.GOPATH = resolve(root, '.tools/gopath');
  }
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.error) { console.error(`${command}: ${result.error.message}`); process.exit(1); }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const npmCli = process.env.npm_execpath || resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
function runNpm(args, cwd) {
  if (existsSync(npmCli)) run(process.execPath, [npmCli, ...args], cwd);
  else run('npm', args, cwd);
}
const core = resolve(root, 'apps/core');
const web = resolve(root, 'apps/web');
const task = process.argv[2];
switch (task) {
  case 'dev': run('docker', ['compose', 'up', '--build', '--wait']); break;
  case 'up': run('docker', ['compose', 'up', '-d', '--wait']); break;
  case 'down': run('docker', ['compose', 'down']); break;
  case 'logs': run('docker', ['compose', 'logs', '-f', '--tail=100']); break;
  case 'test':
    run(process.execPath, ['--test', 'connectors/node-red/simulator.test.mjs']);
    run(process.execPath, ['--test', 'packages/contracts/*.test.mjs', 'apps/connectivity/src/*.test.mjs']);
    run(go, ['test', './...'], core);
    runNpm(['test', '--', '--run', '--minWorkers=1', '--maxWorkers=1'], web);
    break;
  case 'lint':
    run(go, ['vet', './...'], core);
    runNpm(['run', 'lint'], web);
    break;
  case 'build':
    run(go, ['build', '-o', resolve(root, 'dist/rallyx-core') + (process.platform === 'win32' ? '.exe' : ''), './cmd/rallyx-core'], core);
    runNpm(['run', 'build'], web);
    break;
  case 'e2e': run('node', ['--test', 'tests/e2e/platform.test.mjs']); break;
  case 'backup': run('bash', ['scripts/backup.sh']); break;
  case 'package-offline': run('bash', ['scripts/package-offline.sh', ...process.argv.slice(3)]); break;
  default: console.error(`Unknown task: ${task}`); process.exit(1);
}
