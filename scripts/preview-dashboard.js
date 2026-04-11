#!/usr/bin/env node
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const owner = process.argv[2] || 'devops-actions';
if (!process.argv[2]) {
  console.log(`No owner provided; defaulting to '${owner}'. To specify a different owner run: npm run preview-dashboard -- <owner> [org|user]`);
}

try {
  console.log('Installing dependencies (npm ci)...');
  // npm ci is idempotent and ensures local devDependencies like tsc are available
  execSync('npm ci', { stdio: 'inherit' });

  console.log('Building TypeScript (npm run build)...');
  execSync('npm run build', { stdio: 'inherit' });

  // If cache is missing, attempt to collect metrics first (requires GITHUB_TOKEN, gh token, or App creds)
  const ownerType = process.argv[3] || 'org';
  const cacheFile = path.resolve(process.cwd(), 'data', `${owner}.json`);
  if (!fs.existsSync(cacheFile)) {
    console.log(`No cached data found at ${cacheFile}. Attempting to collect metrics for ${owner} (${ownerType})...`);
    // Prefer explicit env GITHUB_TOKEN or App credentials
    let token = process.env.GITHUB_TOKEN;
    const hasAppCreds = !!(process.env.APP_ID && process.env.APP_PRIVATE_KEY);

    // If no env token and no app creds, try GitHub CLI (gh) for a token
    if (!token && !hasAppCreds) {
      try {
        const ghToken = execSync('gh auth token', { stdio: ['pipe', 'pipe', 'ignore'], encoding: 'utf8' }).toString().trim();
        if (ghToken) {
          token = ghToken;
          console.log('Using GitHub CLI token from `gh auth token`.');
        }
      } catch (e) {
        // gh not available or not authenticated; continue to error path below
      }
    }

    if (token || hasAppCreds) {
      try {
        const env = Object.assign({}, process.env);
        if (token) env.GITHUB_TOKEN = token;
        execSync(`node dist/index.js ${owner} ${ownerType}`, { stdio: 'inherit', env });
      } catch (err) {
        console.error('Data collection failed:', err.message || err);
        process.exit(1);
      }
    } else {
      console.error('No GITHUB_TOKEN, gh token, or App credentials found in the environment. Set GITHUB_TOKEN (or run `gh auth login`), or set APP_ID and APP_PRIVATE_KEY, then re-run.');
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
