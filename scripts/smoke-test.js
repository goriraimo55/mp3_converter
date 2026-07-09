const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const js = fs.readFileSync('app.js', 'utf8');
const css = fs.readFileSync('styles.css', 'utf8');

for (const id of ['file-input', 'drop-zone', 'convert-button', 'bitrate-select', 'status', 'progress-bar', 'file-list', 'results']) {
  assert(html.includes(`id="${id}"`), `missing #${id}`);
}

assert(js.includes('MediaRecorder.isTypeSupported'), 'MP3 support check is missing');
assert(js.includes('audio/mpeg'), 'audio/mpeg support is missing');
assert(js.includes('createMediaStreamDestination'), 'audio capture pipeline is missing');
assert(css.includes('.drop-zone'), 'drop zone styles are missing');

console.log('Smoke checks passed.');
