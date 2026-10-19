'use strict';

const fs = require('node:fs');
const path = require('node:path');

function readReleaseConfig() {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(__dirname, 'release-config.json'), 'utf8'));
    const owner = typeof value.owner === 'string' ? value.owner.trim() : '';
    const repo = typeof value.repo === 'string' ? value.repo.trim() : '';
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(repo) || repo === '.' || repo === '..') {
      return { configured: false, owner: '', repo: 'haven-city', releaseUrl: undefined };
    }
    return { configured: true, owner, repo, releaseUrl: `https://github.com/${owner}/${repo}/releases/latest` };
  } catch {
    return { configured: false, owner: '', repo: 'haven-city', releaseUrl: undefined };
  }
}

module.exports = { readReleaseConfig };
