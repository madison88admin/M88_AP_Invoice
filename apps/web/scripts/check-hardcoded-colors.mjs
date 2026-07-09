#!/usr/bin/env node
/**
 * Regression guard: checks migrated components for hardcoded hex colors
 * and Tailwind color utility classes that should use CSS variables instead.
 *
 * Run: node scripts/check-hardcoded-colors.mjs
 *
 * Exits with code 1 if any violations are found.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const COMPONENTS_DIR = join(__dirname, '..', 'src', 'components');

// Components that have been fully migrated to CSS variables
const MIGRATED_COMPONENTS = [
  'ApprovalInbox.tsx',
  'ExceptionManager.tsx',
  'AccountingReview.tsx',
  'AuditLog.tsx',
  'PaymentBatchManager.tsx',
  'Reports.tsx',
  'VendorManagement.tsx',
  'InvoiceUpload.tsx',
];

// Patterns that indicate hardcoded colors
const VIOLATION_PATTERNS = [
  {
    pattern: /bg-\[#[0-9A-Fa-f]{3,8}\]/g,
    label: 'Hardcoded bg-[#hex] Tailwind class',
  },
  {
    pattern: /text-\[#[0-9A-Fa-f]{3,8}\]/g,
    label: 'Hardcoded text-[#hex] Tailwind class',
  },
  {
    pattern: /border-\[#[0-9A-Fa-f]{3,8}\]/g,
    label: 'Hardcoded border-[#hex] Tailwind class',
  },
  {
    pattern: /bg-\[#[0-9A-Fa-f]{3,8}\/\d+\]/g,
    label: 'Hardcoded bg-[#hex/alpha] Tailwind class',
  },
  {
    pattern: /text-\[#[0-9A-Fa-f]{3,8}\/\d+\]/g,
    label: 'Hardcoded text-[#hex/alpha] Tailwind class',
  },
  {
    pattern: /border-white\/\[0\.\d+\]/g,
    label: 'Hardcoded border-white/[alpha] Tailwind class',
  },
  {
    pattern: /bg-white\/\[0\.\d+\]/g,
    label: 'Hardcoded bg-white/[alpha] Tailwind class',
  },
  {
    pattern: /shadow-\[0_\d+px_\d+px_rgba\(0,0,0,0\.\d+\)\]/g,
    label: 'Hardcoded shadow-[rgba] Tailwind class',
  },
];

// Allowed hex colors in Reports.tsx (chart data fills/strokes only)
const REPORTS_ALLOWED_HEX = ['#6C5CE7', '#C6FF3D', '#F59E0B', '#EF4444', '#8884d8', '#3B82F6'];

let violations = [];

function checkFile(filePath, fileName) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const { pattern, label } of VIOLATION_PATTERNS) {
      const matches = line.match(pattern);
      if (matches) {
        for (const match of matches) {
          violations.push({
            file: fileName,
            line: i + 1,
            match,
            label,
          });
        }
      }
    }

    // Check for inline hex colors in style props (but allow chart fills in Reports.tsx)
    const hexInStyle = line.match(/#[0-9A-Fa-f]{6}/g);
    if (hexInStyle) {
      for (const hex of hexInStyle) {
        if (fileName === 'Reports.tsx' && REPORTS_ALLOWED_HEX.includes(hex)) {
          continue;
        }
        // Skip if it's in a comment
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) {
          continue;
        }
        violations.push({
          file: fileName,
          line: i + 1,
          match: hex,
          label: 'Inline hex color (should use CSS variable)',
        });
      }
    }
  }
}

console.log('Checking migrated components for hardcoded colors...\n');

for (const component of MIGRATED_COMPONENTS) {
  const filePath = join(COMPONENTS_DIR, component);
  try {
    checkFile(filePath, component);
  } catch (e) {
    console.error(`Could not read ${component}: ${e.message}`);
  }
}

if (violations.length === 0) {
  console.log('✓ No hardcoded colors found in migrated components.');
  process.exit(0);
} else {
  console.error(`✗ Found ${violations.length} violation(s):\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} — ${v.label}: "${v.match}"`);
  }
  process.exit(1);
}
