const { spawn } = require('child_process');
const path = require('path');

const root = 'C:\\Users\\JC\\OneDrive - Madison88\\AP Invoice';
const apiDir = path.join(root, 'apps', 'api');
const webDir = path.join(root, 'apps', 'web');
const node = '"C:\\Program Files\\nodejs\\node.exe"';
const npxCli = '"C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js"';

function start(name, command, cwd) {
  const p = spawn(command, { cwd, stdio: 'inherit', shell: true });
  p.on('error', (e) => console.error(`[${name}] error:`, e.message));
  p.on('exit', (code) => console.log(`[${name}] exited:`, code));
  return p;
}

console.log('Starting API on port 3001...');
start('API', `${node} ${npxCli} ts-node-dev --respawn --transpile-only src/index.ts`, apiDir);

setTimeout(() => {
  console.log('Starting Web on port 3000...');
  start('WEB', `${node} ${npxCli} vite --host`, webDir);
}, 3000);

process.on('SIGINT', () => process.exit(0));
