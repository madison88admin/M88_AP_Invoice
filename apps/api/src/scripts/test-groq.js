require('dotenv').config({ path: '/opt/ap-invoice/apps/api/.env' });
const { Groq } = require('groq-sdk');

async function main() {
  const g = new Groq({ apiKey: process.env.GROQ_API_KEY });
  try {
    const r = await g.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: 'Say hi' }],
      max_tokens: 5,
    });
    console.log('Groq OK:', r.choices[0].message.content);
  } catch (e) {
    console.log('Groq FAIL:', e.status, (e.message || '').substring(0, 200));
  }
}
main();
