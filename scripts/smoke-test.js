const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const js = fs.readFileSync('app.js', 'utf8');
const css = fs.readFileSync('styles.css', 'utf8');
const lameSource = fs.readFileSync('vendor/lame.min.js', 'utf8');

for (const id of ['file-input', 'drop-zone', 'convert-button', 'bitrate-select', 'status', 'progress-bar', 'file-list', 'results']) {
  assert(html.includes(`id="${id}"`), `missing #${id}`);
}

assert(html.includes('src="vendor/lame.min.js"'), 'lamejs script tag is missing');
assert(js.includes('lamejs.Mp3Encoder'), 'MP3 encoder usage is missing');
assert(js.includes('decodeAudioData'), 'fast decode path is missing');
assert(js.includes('createScriptProcessor'), 'realtime capture fallback is missing');
assert(js.includes('audio/mpeg'), 'MP3 blob type is missing');
assert(css.includes('.drop-zone'), 'drop zone styles are missing');

// Run the bundled encoder outside a browser to prove it produces MP3 frames.
const context = vm.createContext({});
vm.runInContext(`${lameSource};globalThis.__lame = lamejs;`, context);
const lame = context.__lame;
assert.equal(typeof lame.Mp3Encoder, 'function', 'lamejs.Mp3Encoder is not exposed');

const sampleRate = 44100;
const encoder = new lame.Mp3Encoder(2, sampleRate, 192);
const samples = new Int16Array(sampleRate);
for (let i = 0; i < samples.length; i += 1) {
  samples[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0x4000);
}
const chunks = [encoder.encodeBuffer(samples, samples), encoder.flush()].filter((chunk) => chunk.length);
const mp3 = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)));
assert(mp3.length > 1000, `encoded MP3 is suspiciously small (${mp3.length} bytes)`);
assert.equal(mp3[0], 0xff, 'MP3 frame sync byte missing');
assert.equal(mp3[1] & 0xe0, 0xe0, 'MP3 frame sync bits missing');

console.log('Smoke checks passed.');
