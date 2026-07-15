const http = require('http');

const data = JSON.stringify({
  model: 'qwen3:4b',
  prompt: ' ',
  stream: false,
  options: { num_predict: 1 }
});

const req = http.request({
  hostname: 'localhost',
  port: 11434,
  path: '/api/generate',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
}, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Model loaded');
  });
});
req.on('error', (e) => console.error('Error:', e.message));
req.write(data);
req.end();
