import { spawn } from 'node:child_process';

/** Keep pdf2json's PDF.js runtime isolated from other OCR libraries. */
export function extractPdfFallbackText(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = spawn(process.execPath, ['-e', `
      const workerData = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
      const parentPort = { postMessage: value => process.stdout.write('PDF_RESULT ' + JSON.stringify(value) + '\\n') };
      const { PDFDocument } = require(workerData.pdfLib);
      const PDFParser = require(workerData.parser);
      const parser = new PDFParser(null, 1);
      parser.on('pdfParser_dataError', error => {
        parentPort.postMessage({ error: String(error.parserError || error.message || error) });
      });
      parser.on('pdfParser_dataReady', data => {
        try {
          const text = data.Pages.map(page => {
            const rows = [];
            for (const token of [...page.Texts].sort((a, b) => a.y - b.y)) {
              const row = rows[rows.length - 1];
              if (row && token.y - row.y <= 0.15) row.tokens.push(token);
              else rows.push({ y: token.y, tokens: [token] });
            }
            return rows.map(row => row.tokens.sort((a, b) => a.x - b.x).map(token => {
              const value = token.R[0].T;
              try { return decodeURIComponent(value); } catch { return value; }
            }).join(' ')).join('\\n');
          }).join('\\n');
          parentPort.postMessage({ text });
        } catch (error) { parentPort.postMessage({ error: error.message }); }
      });
      (async () => {
        const original = await PDFDocument.load(Buffer.from(workerData.buffer, 'base64'));
        const clean = await PDFDocument.create();
        for (const page of await clean.copyPages(original, original.getPageIndices())) clean.addPage(page);
        parser.parseBuffer(Buffer.from(await clean.save({ useObjectStreams: false })));
      })().catch(error => parentPort.postMessage({ error: error.message }));
    `], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    worker.stdin.end(JSON.stringify({ parser: require.resolve('pdf2json'), pdfLib: require.resolve('pdf-lib'), buffer: buffer.toString('base64') }));
    let output = '';
    worker.stdout.on('data', chunk => {
      output += chunk.toString();
      const match = output.match(/^PDF_RESULT (.+)$/m);
      if (match) finish(JSON.parse(match[1]));
    });
    worker.stderr.resume();
    const timer = setTimeout(() => {
      worker.kill();
      reject(new Error('PDF fallback parsing timed out'));
    }, 30000);
    worker.stdin.on('error', error => { clearTimeout(timer); worker.kill(); reject(error); });
    const finish = (result: { error?: string; text?: string }) => {
      clearTimeout(timer);
      worker.kill();
      if (result.error) reject(new Error(result.error));
      else resolve(result.text || '');
    };
    worker.once('error', error => { clearTimeout(timer); reject(error); });
    worker.once('exit', code => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error('PDF fallback worker exited before completion'));
    });
  });
}
