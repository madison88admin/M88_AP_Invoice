const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://supabase_admin.m88:Madison_88_admin**@5.223.78.194:5432/postgres',
  connectionTimeoutMillis: 15000,
});
client.on('error', (e) => console.log('[client error event]', e.message));

(async () => {
  try {
    console.log('Connecting...');
    await client.connect();
    console.log('Connected!');
    const res = await client.query('SELECT 1 as test');
    console.log('Query result:', res.rows);
    await client.end();
  } catch (e) {
    console.error('Error:', e.message);
  }
})();
