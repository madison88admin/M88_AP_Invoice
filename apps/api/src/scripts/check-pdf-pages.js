const { convert } = require('@opendataloader/pdf');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function main() {
  const inputPath = '/incoming-invoices/manual-review/Nilorn HK Invoice INVP0258309 Care Label.pdf';
  const fileBuffer = fs.readFileSync(inputPath);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'odl-formats-'));
  const tmpInput = path.join(tmpDir, 'input.pdf');

  fs.writeFileSync(tmpInput, fileBuffer);

  // Try HTML format
  console.log('=== HTML EXTRACTION ===');
  const htmlDir = path.join(tmpDir, 'html');
  await convert(tmpInput, { outputDir: htmlDir, format: 'html', quiet: true, keepLineBreaks: true });
  const htmlFiles = fs.readdirSync(htmlDir);
  const htmlFile = htmlFiles.find(f => f.endsWith('.html'));
  if (htmlFile) {
    const html = fs.readFileSync(path.join(htmlDir, htmlFile), 'utf8');
    console.log('HTML length:', html.length);
    // Search for bank keywords in HTML
    const lines = html.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(/bank|swift|account|beneficiar|remittance|payment|HSBC|DBS|Standard Chartered/i)) {
        console.log(`Line ${i}: ${lines[i].trim().substring(0, 200)}`);
      }
    }
    // Print last 1000 chars
    console.log('\n=== LAST 1000 CHARS OF HTML ===');
    console.log(html.substring(html.length - 1000));
  }

  // Try Markdown format
  console.log('\n\n=== MARKDOWN EXTRACTION ===');
  const mdDir = path.join(tmpDir, 'markdown');
  await convert(tmpInput, { outputDir: mdDir, format: 'markdown', quiet: true, keepLineBreaks: true });
  const mdFiles = fs.readdirSync(mdDir);
  const mdFile = mdFiles.find(f => f.endsWith('.md'));
  if (mdFile) {
    const md = fs.readFileSync(path.join(mdDir, mdFile), 'utf8');
    console.log('Markdown length:', md.length);
    // Search for bank keywords
    const mdLines = md.split('\n');
    for (let i = 0; i < mdLines.length; i++) {
      if (mdLines[i].match(/bank|swift|account|beneficiar|remittance|payment|HSBC|DBS|Standard Chartered/i)) {
        console.log(`Line ${i}: ${mdLines[i].trim().substring(0, 200)}`);
      }
    }
    // Print last 1000 chars
    console.log('\n=== LAST 1000 CHARS OF MARKDOWN ===');
    console.log(md.substring(md.length - 1000));
  }

  // Try markdown with HTML
  console.log('\n\n=== MARKDOWN WITH HTML ===');
  const mdHtmlDir = path.join(tmpDir, 'markdown-html');
  await convert(tmpInput, { outputDir: mdHtmlDir, format: 'markdown', quiet: true, keepLineBreaks: true, markdownWithHtml: true });
  const mdHtmlFiles = fs.readdirSync(mdHtmlDir);
  const mdHtmlFile = mdHtmlFiles.find(f => f.endsWith('.md'));
  if (mdHtmlFile) {
    const mdHtml = fs.readFileSync(path.join(mdHtmlDir, mdHtmlFile), 'utf8');
    console.log('Markdown+HTML length:', mdHtml.length);
    const mdHtmlLines = mdHtml.split('\n');
    for (let i = 0; i < mdHtmlLines.length; i++) {
      if (mdHtmlLines[i].match(/bank|swift|account|beneficiar|remittance|payment|HSBC|DBS|Standard Chartered/i)) {
        console.log(`Line ${i}: ${mdHtmlLines[i].trim().substring(0, 200)}`);
      }
    }
    console.log('\n=== LAST 1000 CHARS ===');
    console.log(mdHtml.substring(mdHtml.length - 1000));
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

main().catch(e => { console.error(e); process.exit(1); });
