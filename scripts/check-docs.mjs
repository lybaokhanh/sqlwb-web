#!/usr/bin/env node
// Feature docs and release notes check.
//
//   node scripts/check-docs.mjs                  Check docs/features, docs/images, CHANGELOG.md links.
//   node scripts/check-docs.mjs --pr <base-ref>  Also: a feat commit since <base-ref> must change
//                                                CHANGELOG.md, docs/features/ and docs/images/.
//   node scripts/check-docs.mjs --notes <tag> [--ref <git-ref>]  Print the CHANGELOG section of <tag> as release notes
//                                                (links and images point to <git-ref>, default the tag).
//
// Exit 1 on a problem. Rules: CONTRIBUTING.md#feature-docs-and-releases
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const FEATURES = join(ROOT, 'docs/features');
const IMAGES = join(ROOT, 'docs/images');
const CHANGELOG = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
const errors = [];
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();

function releaseNotes(tag, ref = tag) {
  const version = tag.replace(/^v/, '');
  const re = new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\][^\\n]*\\n([\\s\\S]*?)(?=^## \\[|^\\[[^\\]]+\\]: )`, 'm');
  const m = CHANGELOG.match(re);
  if (!m || !m[1].trim()) {
    console.error(`CHANGELOG.md has no section "## [${version}]" with content.`);
    process.exit(1);
  }
  const repo = process.env.GITHUB_REPOSITORY ?? 'lybaokhanh/sqlwb-web';
  return m[1].trim()
    .replace(/!\[([^\]]*)\]\((docs\/[^)]+)\)/g, `![$1](https://raw.githubusercontent.com/${repo}/${ref}/$2)`)
    .replace(/(?<!!)\[([^\]]*)\]\((docs\/[^)]+)\)/g, `[$1](https://github.com/${repo}/blob/${ref}/$2)`);
}

const notesTag = opt('--notes');
if (notesTag) {
  process.stdout.write(releaseNotes(notesTag, opt('--ref')) + '\n');
  process.exit(0);
}

// 1. Each feature doc has a demo image that exists, and is listed in the index and the changelog.
const index = readFileSync(join(FEATURES, 'README.md'), 'utf8');
const docs = readdirSync(FEATURES).filter((f) => f.endsWith('.md') && f !== 'README.md');
const usedImages = new Set();
for (const f of docs) {
  const text = readFileSync(join(FEATURES, f), 'utf8');
  if (!/^Since: v\d+\.\d+\.\d+|^Since: Unreleased/m.test(text)) errors.push(`docs/features/${f}: no "Since: vX.Y.Z" line`);
  const imgs = [...text.matchAll(/!\[[^\]]*\]\(\.\.\/images\/([^)]+)\)/g)].map((m) => m[1]);
  if (!imgs.length) errors.push(`docs/features/${f}: no demo image (../images/<name>.png)`);
  for (const i of imgs) {
    usedImages.add(i);
    if (!existsSync(join(IMAGES, i))) errors.push(`docs/features/${f}: image docs/images/${i} is missing`);
  }
  if (!index.includes(`(${f})`)) errors.push(`docs/features/README.md: no link to ${f}`);
  if (!CHANGELOG.includes(`docs/features/${f}`)) errors.push(`CHANGELOG.md: no entry links docs/features/${f}`);
}

// 2. Every link into docs/ from the changelog exists. No unused images.
for (const m of CHANGELOG.matchAll(/\]\((docs\/[^)#]+)/g)) {
  if (!existsSync(join(ROOT, m[1]))) errors.push(`CHANGELOG.md: ${m[1]} does not exist`);
}
for (const i of readdirSync(IMAGES)) {
  if (!usedImages.has(i)) errors.push(`docs/images/${i}: no feature doc uses it`);
}

// 3. PR: a feat commit needs docs, a demo image and a changelog entry.
const base = opt('--pr');
if (base) {
  const subjects = git('log', '--format=%s', `${base}..HEAD`).split('\n').filter(Boolean);
  const feats = subjects.filter((s) => /^feat(\(.+\))?!?:/.test(s));
  if (feats.length) {
    const changed = git('diff', '--name-only', `${base}...HEAD`).split('\n');
    const need = [
      ['CHANGELOG.md', (p) => p === 'CHANGELOG.md'],
      ['docs/features/*.md', (p) => p.startsWith('docs/features/')],
      ['docs/images/*.png', (p) => p.startsWith('docs/images/')],
    ];
    for (const [what, test] of need) {
      if (!changed.some(test)) errors.push(`feat commit (${feats[0]}) but no change in ${what}`);
    }
    if (!/## \[Unreleased\]\s*\n+### /.test(CHANGELOG)) errors.push('CHANGELOG.md: "## [Unreleased]" has no entries');
  }
}

if (errors.length) {
  console.error(`Docs check failed (${errors.length}):\n- ${errors.join('\n- ')}\n\nRules: CONTRIBUTING.md#feature-docs-and-releases`);
  process.exit(1);
}
console.log(`Docs check OK: ${docs.length} feature docs, ${usedImages.size} demo images.`);
