const { execSync } = require('child_process');

const host = 'root@5.223.78.194';
const password = 'M@dis0n_88_server*';
const cmd = process.argv[2] || 'echo SSH_OK';

try {
  const result = execSync(`echo '${password}' | ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 ${host} "${cmd}"`, {
    encoding: 'utf-8',
    timeout: 30000,
  });
  console.log(result);
} catch (e) {
  // Try with sshpass-like approach using expect alternative
  console.error('Direct pipe failed. Trying alternative...');
  console.error(e.message);
}
