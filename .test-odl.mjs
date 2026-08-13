import { convert } from "@opendataloader/pdf";
import fs from "fs";
import path from "path";

async function main() {
  const testPdfs = [
    "/tmp/bulk-upload/CHECKPOINT- IA00493973.pdf",
    "/tmp/bulk-upload/Nilorn INVP0258020 Hangtag.pdf",
  ];

  for (const pdf of testPdfs) {
    if (!fs.existsSync(pdf)) {
      console.log(`NOT FOUND: ${pdf}`);
      continue;
    }
    const name = path.basename(pdf, ".pdf");
    const outDir = `/tmp/odl-test/${name}`;
    fs.mkdirSync(outDir, { recursive: true });

    console.log(`\n=== Processing: ${name} ===`);
    const start = Date.now();
    try {
      await convert([pdf], {
        outputDir: outDir,
        format: "markdown,json",
        quiet: true,
      });
      const elapsed = ((Date.now() - start) / 1000).toFixed(2);
      console.log(`Time: ${elapsed}s`);

      // Read markdown output
      const mdFile = path.join(outDir, name + ".md");
      if (fs.existsSync(mdFile)) {
        const md = fs.readFileSync(mdFile, "utf-8");
        console.log(`Markdown size: ${md.length} chars`);
        console.log(`First 500 chars:\n${md.substring(0, 500)}`);
      } else {
        // Find any .md file
        const files = fs.readdirSync(outDir).filter(f => f.endsWith(".md"));
        if (files.length > 0) {
          const md = fs.readFileSync(path.join(outDir, files[0]), "utf-8");
          console.log(`Markdown file: ${files[0]}, size: ${md.length} chars`);
          console.log(`First 500 chars:\n${md.substring(0, 500)}`);
        } else {
          console.log(`No markdown found. Files: ${fs.readdirSync(outDir).join(", ")}`);
        }
      }
    } catch (e) {
      console.error(`Error: ${e}`);
    }
  }
}

main().catch(console.error);
