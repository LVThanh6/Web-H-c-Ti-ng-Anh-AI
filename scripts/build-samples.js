import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const samplesDir = path.join(root, 'samples');
const manifest = JSON.parse(fs.readFileSync(path.join(samplesDir, 'index.json'), 'utf8'));

if (!Array.isArray(manifest.samples) || manifest.samples.length === 0) {
  throw new Error('samples/index.json must contain at least one sample.');
}

const samples = {};
for (const item of manifest.samples) {
  if (!item.id || !item.title || !/^[a-z0-9-]+\.json$/i.test(item.file)) {
    throw new Error(`Invalid sample manifest entry: ${JSON.stringify(item)}`);
  }

  const sample = JSON.parse(fs.readFileSync(path.join(samplesDir, item.file), 'utf8'));
  if (sample.id !== item.id || sample.title !== item.title || !sample.text || !Array.isArray(sample.vocabulary)) {
    throw new Error(`Sample data does not match manifest entry ${item.id}.`);
  }
  samples[item.file] = sample;
}

const offlineData = JSON.stringify({ index: manifest, samples })
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');
fs.writeFileSync(
  path.join(samplesDir, 'offline.js'),
  `'use strict';\nwindow.LINGUAREAD_OFFLINE_SAMPLES = ${offlineData};\n`,
  'utf8'
);
console.log(`Built offline sample bundle with ${manifest.samples.length} sample(s).`);
