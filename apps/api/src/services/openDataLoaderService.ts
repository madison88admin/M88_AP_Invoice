import { convert } from "@opendataloader/pdf";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { logger } from "../utils/logger";

/**
 * OpenDataLoader PDF extraction service.
 * Converts PDF → clean Markdown (correct reading order, tables, structure).
 * This replaces pdf2json as the primary text extraction layer.
 *
 * Flow: PDF → OpenDataLoader (local, 0.015s/page) → Markdown → AI engine (field extraction)
 *
 * Advantages over pdf2json:
 * - Correct multi-column reading order (XY-Cut++)
 * - Table structure preserved
 * - Bounding boxes for every element
 * - #1 in PDF parsing benchmarks (0.907 score)
 * - Local-first, no rate limits
 */
export class OpenDataLoaderService {
  /**
   * Extract clean Markdown text from a PDF buffer.
   * Returns the Markdown content directly (no temp files needed by caller).
   *
   * @param pdfBuffer - PDF file as Buffer
   * @param fileName - Original filename (for temp dir naming)
   * @returns Markdown string with correct reading order and table structure
   */
  static async extractMarkdown(pdfBuffer: Buffer, fileName?: string): Promise<string> {
    const tmpDir = path.join(os.tmpdir(), `odl-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    // Write PDF to temp file
    const baseName = (fileName || "invoice").replace(/[^a-zA-Z0-9-_]/g, "_");
    const pdfPath = path.join(tmpDir, `${baseName}.pdf`);
    fs.writeFileSync(pdfPath, pdfBuffer);

    const outputDir = path.join(tmpDir, "output");
    fs.mkdirSync(outputDir, { recursive: true });

    try {
      const start = Date.now();
      await convert([pdfPath], {
        outputDir,
        format: "markdown",
        quiet: true,
      });
      const elapsed = ((Date.now() - start) / 1000).toFixed(2);
      logger.info(`[OpenDataLoader] Extracted in ${elapsed}s`);

      // Find the .md output file
      const mdFiles = fs.readdirSync(outputDir).filter(f => f.endsWith(".md"));
      if (mdFiles.length === 0) {
        throw new Error("No markdown output file generated");
      }

      const markdown = fs.readFileSync(path.join(outputDir, mdFiles[0]), "utf-8");

      // Clean up temp files
      this.cleanupDir(tmpDir);

      return markdown;
    } catch (error) {
      this.cleanupDir(tmpDir);
      logger.error("[OpenDataLoader] Extraction failed:", error);
      throw error;
    }
  }

  /**
   * Extract Markdown and also return JSON elements with bounding boxes.
   * Useful for advanced extraction (e.g., bank details location verification).
   */
  static async extractStructured(pdfBuffer: Buffer, fileName?: string): Promise<{
    markdown: string;
    json: any;
  }> {
    const tmpDir = path.join(os.tmpdir(), `odl-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    const baseName = (fileName || "invoice").replace(/[^a-zA-Z0-9-_]/g, "_");
    const pdfPath = path.join(tmpDir, `${baseName}.pdf`);
    fs.writeFileSync(pdfPath, pdfBuffer);

    const outputDir = path.join(tmpDir, "output");
    fs.mkdirSync(outputDir, { recursive: true });

    try {
      const start = Date.now();
      await convert([pdfPath], {
        outputDir,
        format: "markdown,json",
        quiet: true,
      });
      const elapsed = ((Date.now() - start) / 1000).toFixed(2);
      logger.info(`[OpenDataLoader] Structured extraction in ${elapsed}s`);

      const mdFiles = fs.readdirSync(outputDir).filter(f => f.endsWith(".md"));
      const jsonFiles = fs.readdirSync(outputDir).filter(f => f.endsWith(".json"));

      const markdown = mdFiles.length > 0
        ? fs.readFileSync(path.join(outputDir, mdFiles[0]), "utf-8")
        : "";
      const json = jsonFiles.length > 0
        ? JSON.parse(fs.readFileSync(path.join(outputDir, jsonFiles[0]), "utf-8"))
        : null;

      this.cleanupDir(tmpDir);

      return { markdown, json };
    } catch (error) {
      this.cleanupDir(tmpDir);
      logger.error("[OpenDataLoader] Structured extraction failed:", error);
      throw error;
    }
  }

  /**
   * Recursively delete a directory and its contents.
   */
  private static cleanupDir(dirPath: string) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
    } catch {
      // Non-critical, ignore
    }
  }
}

/**
 * Extract plain text from a PDF buffer using OpenDataLoader.
 * Returns clean Markdown with correct reading order and table structure.
 * This is the primary text extraction function used by ocrService.ts.
 *
 * @param pdfBuffer - PDF file as Buffer
 * @returns Markdown string with correct reading order
 */
export async function extractTextWithOpenDataLoader(pdfBuffer: Buffer): Promise<string> {
  return OpenDataLoaderService.extractMarkdown(pdfBuffer);
}

/**
 * Extract Markdown and JSON (with bounding boxes) from a PDF buffer.
 */
export async function extractStructuredWithOpenDataLoader(pdfBuffer: Buffer): Promise<{
  markdown: string;
  json: any;
}> {
  return OpenDataLoaderService.extractStructured(pdfBuffer);
}

export default OpenDataLoaderService;
