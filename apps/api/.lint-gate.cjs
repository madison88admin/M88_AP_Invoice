/**
 * Lint ratchet gate for apps/api.
 *
 * ESLint config is strict (rules at 'error'), but the codebase carries legacy
 * debt. This gate makes the debt a ratchet: any finding count that GROWS for
 * a given (file, rule) pair — including brand-new pairs — fails, so new
 * unused-vars (and any other escalated rule violation) cannot land. Reducing
 * counts never fails; run `node .lint-gate.cjs --update` after doing cleanup
 * to lower the baseline.
 *
 * Runs raw eslint via node (no shell) and parses the JSON report even when
 * eslint exits 1 because of legacy findings.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const API_DIR = __dirname;
const BASELINE_PATH = path.join(API_DIR, '.lint-baseline.json');

function runEslintJson() {
  const pkgPath = require.resolve('eslint/package.json');
  const bin = path.join(path.dirname(pkgPath), 'bin', 'eslint.js');
  if (!fs.existsSync(bin)) throw new Error('eslint bin not found at ' + bin);
  // Direct node spawn — no shell (cmd.exe) involved.
  const r = spawnSync(process.execPath, [bin, 'src', '--format', 'json'], {
    cwd: API_DIR,
    encoding: 'latin1',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (!r.stdout) {
    throw new Error('eslint produced no JSON output: ' + String(r.stderr || '').slice(0, 400));
  }
  return JSON.parse(r.stdout);
}

function relOf(file) {
  return file.replace(/^.*[\\/]apps[\\/]api[\\/]/, '').replace(/\\/g, '/');
}

function fingerprintOf(m) {
  return `${m.ruleId}|${m.severity}|${(m.message || '').slice(0, 160)}`;
}

function countByPair(report) {
  const counts = new Map();
  const samples = new Map();
  for (const f of report) {
    const rel = relOf(f.filePath);
    for (const m of f.messages || []) {
      if (!m.ruleId) continue; // parse errors surfaced separately
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
  const { counts, samples } = countByPair(report);

  const currentObj = {};
  for (const [k, v] of counts) currentObj[k] = v;

  if (update) {
    fs.writeFileSync(
      BASELINE_PATH,
      JSON.stringify({
        _comment: 'Lint ratchet baseline for apps/api. Regenerate via: node .lint-gate.cjs --update (only after real cleanup).',
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
};
