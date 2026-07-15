const { ollamaFineTuneService } = require('../../dist/services/ollamaFineTuneService');

async function main() {
  try {
    const result = await ollamaFineTuneService.buildDataset(3);
    console.log('Dataset built:', result);
    
    // Check dataset quality
    const fs = require('fs');
    const lines = fs.readFileSync(result.path, 'utf8').split('\n').filter(l => l.trim());
    let withInput = 0;
    let withoutInput = 0;
    for (const line of lines) {
      const entry = JSON.parse(line);
      if (entry.input && entry.input.length > 10) {
        withInput++;
      } else {
        withoutInput++;
      }
    }
    console.log(`Dataset quality: ${withInput} with input, ${withoutInput} without input, ${lines.length} total`);
    
    // Start fine-tuning
    console.log('\nStarting fine-tune...');
    const ftResult = await ollamaFineTuneService.startFineTune({
      minCorrections: 3,
      epochs: 3,
    });
    console.log('Fine-tune started:', ftResult);
  } catch (e) {
    console.error('Error:', e.message);
  }
}
main();
