#!/usr/bin/env node
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const owner = process.argv[2];
if (!owner) {
  console.error('Usage: npm run preview-dashboard -- <owner>');
  process.exit(1);
}

try {
  console.log('Installing dependencies (npm ci)...');
  // npm ci is idempotent and ensures local devDependencies like tsc are available
  execSync('npm ci', { stdio: 'inherit' });

  console.log('Building TypeScript (npm run build)...');
  execSync('npm run build', { stdio: 'inherit' });

  console.log(`Generating site for ${owner}...`);
  execSync(`node dist/build-pages.js ${owner}`, { stdio: 'inherit' });

  const index = path.resolve(process.cwd(), '_site', 'index.html');
  if (!fs.existsSync(index)) {
    console.error('No _site/index.html found — build may have failed.');
    process.exit(1);
  }

  console.log('Opening _site/index.html in the default browser...');
  const platform = process.platform;
  const cmd = platform === 'win32'
    ? `start "" "${index}"`
    : platform === 'darwin'
      ? `open "${index}"`
      : `xdg-open "${index}"`;
  execSync(cmd, { stdio: 'inherit', shell: true });
} catch (err) {
  console.error('Preview failed:', err.message || err);
  process.exit(1);
}
