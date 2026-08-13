/**
 * Deploy the PDF viewing fix to the VPS:
 * 1. Git pull latest changes
 * 2. Build the API
 * 3. Restart the API service
 * 4. Health check
 */
const { exec } = require('child_process');

const HOST = '5.223.78.194';
const USER = 'root';
const PASS = 'M@dis0n_88_server*';

const sshBase = `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 ${USER}@${HOST}`;
const scpBase = `scp -o StrictHostKeyChecking=no`;

function run(cmd, label) {
  return new Promise((resolve, reject) => {
    console.log(`\n[${label}] Running...`);
    const fullCmd = process.platform === 'win32'
      ? `echo y | plink -ssh -l ${USER} -pw "${PASS}" ${HOST} "${cmd}"`
      : `${sshBase} "${cmd}"`;
    exec(fullCmd, { maxBuffer: 1024 * 1024 * 10, timeout: 120000 }, (err, stdout, stderr) => {
      if (stdout) console.log(stdout.trim());
      if (stderr && !stderr.includes('Warning')) console.error('STDERR:', stderr.trim());
      if (err) {
        console.error(`[${label}] ERROR:`, err.message);
        reject(err);
      } else {
        resolve(stdout);
      }
    });
  });
}

async function main() {
  console.log('=== Deploying PDF Viewing Fix to VPS ===\n');

  try {
    // 1. Git pull
    await run('cd /opt/ap-invoice && git pull origin main', 'Git Pull');

    // 2. Build API
    await run('cd /opt/ap-invoice && npm run build --workspace=api 2>&1 | tail -5', 'Build API');

    // 3. Restart API
    await run('systemctl restart ap-invoice-api', 'Restart API');

    // 4. Wait and health check
    await new Promise(r => setTimeout(r, 5000));
    await run('curl -s http://localhost:3001/api/health', 'Health Check');

    console.log('\n=== Deployment Complete ===');
  } catch (err) {
    console.error('\n=== Deployment FAILED ===');
    process.exit(1);
  }
}

main();
