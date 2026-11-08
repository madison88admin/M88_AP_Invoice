/**
 * Lint ratchet gate for apps/web (mirror of apps/api/.lint-gate.cjs).
 *
 * ESLint config is warning-level, but this gate makes the warnings a ratchet:
 * warning counts for a given (file, rule) pair — including brand-new pairs —
 * fail when they GROW, so new lint debt cannot land. Reducing counts never
 * fails; run `node .lint-gate.cjs --update` after real cleanup to lower the
 * baseline.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const WEB_DIR = __dirname;
const ROOT_DIR = path.resolve(WEB_DIR, '..', '..');
const BASELINE_PATH = path.join(WEB_DIR, '.lint-baseline.json');

function runEslintJson() {
  const pkgPath = require.resolve('eslint/package.json', { paths: [WEB_DIR, ROOT_DIR] });
  const bin = path.join(path.dirname(pkgPath), 'bin', 'eslint.js');
  if (!fs.existsSync(bin)) throw new Error('eslint bin not found at ' + bin);
  // Direct node spawn — no shell (cmd.exe) involved.
  const r = spawnSync(process.execPath, [bin, 'src', '--format', 'json'], {
    cwd: WEB_DIR,
    encoding: 'latin1',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (!r.stdout) {
    throw new Error('eslint produced no JSON output: ' + String(r.stderr || '').slice(0, 400));
  }
  return JSON.parse(r.stdout);
}

function relOf(file) {
  return file.replace(/^.*[\\/]apps[\\/]web[\\/]/, '').replace(/\\/g, '/');
}

function countByPair(report) {
  const counts = new Map();
  const samples = new Map();
  for (const f of report) {
    const rel = relOf(f.filePath);
    for (const m of f.messages || []) {
      if (!m.ruleId) continue; // parse errors surfaced separately below
      const key = `${rel}::${m.ruleId}`;
      counts.set(key, (counts.get(key) || 0) + 1);
      if (!samples.has(key)) samples.set(key, []);
      const list = samples.get(key);
      if (list.length < 8) list.push(`${rel}:${m.line}:${m.column} [${m.ruleId}] ${m.message}`);
    }
  }
  return { counts, samples };
}

function main() {
  const update = process.argv.includes('--update');
  const report = runEslintJson();

  // parse errors are real breakage, never grandfathered
  const parseErrors = [];
  for (const f of report) {
    for (const m of f.messages || []) {
      if (!m.ruleId) parseErrors.push(`${relOf(f.filePath)}:${m.line}:${m.column} ${m.message}`);
    }
  }

  const { counts, samples } = countByPair(report);
  // ruleless warnings are `reportUnusedDisableDirectives` reports — ratchet them;
  // ruleless ERRORS are real parse failures — never grandfather
  for (const f of report) {
    for (const m of f.messages || []) {
      if (!m.ruleId && m.severity !== 2) {
        const key = `${relOf(f.filePath)}::(unused-disable-directive)`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  }
  const currentObj = {};
  for (const [k, v] of counts) currentObj[k] = v;

  if (update) {
    if (parseErrors.length) {
      console.error('lint gate: cannot update baseline while parse errors exist:');
      for (const p of parseErrors) console.error('  ' + p);
      process.exit(1);
    }
    fs.writeFileSync(
      BASELINE_PATH,
      JSON.stringify({
        _comment: 'Lint ratchet baseline for apps/web. Regenerate via: node .lint-gate.cjs --update (only after real cleanup).',
        generated_at: new Date().toISOString(),
        total: Object.values(currentObj).reduce((a, b) => a + b, 0),
        counts: currentObj,
      }, null, 2) + '\n'
    );
    console.log(`baseline updated: ${Object.keys(currentObj).length} file/rule pairs, ${Object.values(currentObj).reduce((a, b) => a + b, 0)} findings`);
    return;
  }

  const baseline = fs.existsSync(BASELINE_PATH)
    ? JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
    : { counts: {} };

  const violations = [];
  for (const [key, count] of counts) {
    const baseCount = baseline.counts[key] || 0;
    if (count > baseCount) violations.push({ key, count, baseCount });
  }

  const total = Object.values(currentObj).reduce((a, b) => a + b, 0);
  const totalBase = Object.values(baseline.counts || {}).reduce((a, b) => a + b, 0);

  if (parseErrors.length) {
    console.error(`lint gate: FAIL — parse errors are never grandfathered (${parseErrors.length})`);
    for (const p of parseErrors.slice(0, 10)) console.error('  ' + p);
    process.exit(1);
  }

  if (violations.length === 0) {
    console.log(`lint gate: PASS — ${total} findings (baseline ${totalBase}); ratchet holds${total < totalBase ? ' — run --update to lower the baseline' : ''}`);
    process.exit(0);
  }

  console.error(`lint gate: FAIL — new eslint findings exceed baseline (current ${total} vs baseline ${totalBase})`);
  for (const v of violations) {
    console.error(`  +${v.count - v.baseCount}  ${v.key}`);
    for (const s of samples.get(v.key) || []) console.error(`      ${s}`);
  }
  console.error('Fix the new findings (never refactor legacy code in the same commit).');
  process.exit(1);
}

try {
  main();
} catch (e) {
  console.error('lint gate: error —', e instanceof Error ? e.message : e);
  process.exit(2);
}
