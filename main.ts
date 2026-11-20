// Vice City Sunset Cover Studio — the hand-in program (Node 22, standard
// library only). It gathers the entry the agent built in this repository
// (the static app under app/ and the screenshots under screenshots/) and
// writes them to the grader's output directory with the dossier the judge
// reads. Run it outside the grader with MAKEFUN_OUTPUT_DIR set:
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// The grader runs it twice in a fresh container; both runs must write the
// same bytes, so this program copies files as they are and never stamps a
// time, a random value or a machine path into the output.

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-app.ts';

// The repository root is the directory this file lives in.
const repoRoot = fileURLToPath(new URL('.', import.meta.url));

// Inside the grader /output is the hand-in directory; anywhere else the
// caller points MAKEFUN_OUTPUT_DIR at a scratch directory instead.
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

function countEntries(dir) {
  let files = 0;
  let bytes = 0;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const info = statSync(path);
    if (info.isDirectory()) {
      const sub = countEntries(path);
      files += sub.files;
      bytes += sub.bytes;
    } else if (info.isFile()) {
      files += 1;
      bytes += info.size;
    }
  }
  return { files, bytes };
}

function requireDir(path, label) {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(label + ' is missing: ' + path);
  }
}

// The gate refuses an entry whose index.html is over 1 MiB, so check the
// entry's own front door before handing anything in.
function requireIndexHtml(appDir) {
  const indexPath = join(appDir, 'index.html');
  if (!existsSync(indexPath) || !statSync(indexPath).isFile()) {
    throw new Error('app/index.html is missing: ' + indexPath);
  }
  const size = statSync(indexPath).size;
  if (size > 1024 * 1024) {
    throw new Error('app/index.html is ' + size + ' bytes, over the 1 MiB cap');
  }
  return size;
}

function main() {
  const appDir = join(repoRoot, 'app');
  const shotsDir = join(repoRoot, 'screenshots');
  requireDir(appDir, 'app/');
  requireDir(shotsDir, 'screenshots/');
  const indexSize = requireIndexHtml(appDir);

  const appStats = countEntries(appDir);
  const shotStats = countEntries(shotsDir);
  const shotNames = readdirSync(shotsDir)
    .filter((name) => !name.startsWith('.'))
    .sort();
  if (shotNames.length < 3 || shotNames.length > 4) {
    throw new Error('screenshots/ must hold 3 or 4 images, found ' + shotNames.length);
  }
  if (shotStats.bytes > 4 * 262144) {
    throw new Error('screenshots/ are over the 256 KiB-per-image budget in total');
  }

  mkdirSync(outputDir, { recursive: true });
  cpSync(appDir, join(outputDir, 'app'), { recursive: true });
  mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
  cpSync(shotsDir, join(outputDir, 'screenshots'), { recursive: true });

  // The scorer's own caps (reference/gate.json): only text_max_bytes shapes
  // the dossier bytes; the rest refuse an entry the scorer would refuse.
  const dossier = buildDossier(outputDir, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    app_max_files: 993,
    app_max_bytes: 50331648,
    app_path_max_bytes: 1000,
  });
  // The gate refuses a dossier over 1.5 MiB; refuse it here first.
  if (dossier.length > 1572864) {
    throw new Error('dossier.json is ' + dossier.length + ' bytes, over the 1.5 MiB cap');
  }
  writeFileSync(join(outputDir, 'dossier.json'), dossier);

  console.log(
    'handed in: app/ ' + appStats.files + ' files, ' + appStats.bytes + ' bytes ' +
    '(index.html ' + indexSize + ' bytes); ' +
    'screenshots/ ' + shotNames.join(', ') + '; dossier.json ' + dossier.length + ' bytes',
  );
}

main();
