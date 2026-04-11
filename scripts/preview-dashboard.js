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

  // If cache is missing, attempt to collect metrics first (requires GITHUB_TOKEN or App creds)
  const ownerType = process.argv[3] || 'org';
  const cacheFile = path.resolve(process.cwd(), 'data', `${owner}.json`);
  if (!fs.existsSync(cacheFile)) {
    console.log(`No cached data found at ${cacheFile}. Attempting to collect metrics for ${owner} (${ownerType})...`);
    if (process.env.GITHUB_TOKEN || (process.env.APP_ID && process.env.APP_PRIVATE_KEY)) {
      try {
        execSync(`node dist/index.js ${owner} ${ownerType}`, { stdio: 'inherit' });
      } catch (err) {
        console.error('Data collection failed:', err.message || err);
        process.exit(1);
      }
    } else {
      console.error('No GITHUB_TOKEN or App credentials found in the environment. Set GITHUB_TOKEN (or APP_ID and APP_PRIVATE_KEY) and re-run.');
      process.exit(1);
    }
  }

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
