const fileInput = document.querySelector('#file-input');
const dropZone = document.querySelector('#drop-zone');
const convertButton = document.querySelector('#convert-button');
const bitrateSelect = document.querySelector('#bitrate-select');
const statusBox = document.querySelector('#status');
const progressBar = document.querySelector('#progress-bar');
const fileList = document.querySelector('#file-list');
const results = document.querySelector('#results');

let selectedFiles = [];

const MP3_BLOCK_SAMPLES = 1152 * 32;

function hasMp3Encoder() {
  return typeof lamejs !== 'undefined' && typeof lamejs.Mp3Encoder === 'function';
}

function setStatus(message, isError = false) {
  statusBox.textContent = message;
  statusBox.classList.toggle('error', isError);
}

function setProgress(value) {
  progressBar.style.width = `${Math.max(0, Math.min(100, value))}%`;
}

function updateFileList() {
  fileList.innerHTML = '';
  selectedFiles.forEach((file) => {
    const item = document.createElement('li');
    item.textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`;
    fileList.appendChild(item);
  });
  convertButton.disabled = selectedFiles.length === 0;
  setStatus(selectedFiles.length ? `${selectedFiles.length} 件のファイルを変換できます。` : 'ファイルを選択してください。');
  setProgress(0);
}

function acceptFiles(files) {
  selectedFiles = Array.from(files).filter((file) => /\.(mp4|webm)$/i.test(file.name) || ['video/mp4', 'video/webm'].includes(file.type));
  results.innerHTML = '';
  updateFileList();
  if (!selectedFiles.length) setStatus('MP4またはWebMファイルを選択してください。', true);
}

function yieldToUi() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function toInt16(sample) {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
}

function concatFloat32(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    merged.set(chunk, offset);
    offset += chunk.length;
  });
  return merged;
}

async function encodeToMp3(channelData, sampleRate, kbps, onProgress) {
  const numChannels = channelData.length;
  const encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, kbps);
  const left = channelData[0];
  const right = numChannels === 2 ? channelData[1] : null;
  const leftInt = new Int16Array(MP3_BLOCK_SAMPLES);
  const rightInt = right ? new Int16Array(MP3_BLOCK_SAMPLES) : null;
  const chunks = [];

  for (let offset = 0; offset < left.length; offset += MP3_BLOCK_SAMPLES) {
    const count = Math.min(MP3_BLOCK_SAMPLES, left.length - offset);
    for (let i = 0; i < count; i += 1) {
      leftInt[i] = toInt16(left[offset + i]);
      if (rightInt) rightInt[i] = toInt16(right[offset + i]);
    }
    const encoded = rightInt
      ? encoder.encodeBuffer(leftInt.subarray(0, count), rightInt.subarray(0, count))
      : encoder.encodeBuffer(leftInt.subarray(0, count));
    if (encoded.length) chunks.push(encoded);
    onProgress((offset + count) / left.length);
    await yieldToUi();
  }

  const tail = encoder.flush();
  if (tail.length) chunks.push(tail);
  return new Blob(chunks, { type: 'audio/mpeg' });
}

function extractChannels(audioBuffer) {
  const channels = [audioBuffer.getChannelData(0)];
  if (audioBuffer.numberOfChannels > 1) channels.push(audioBuffer.getChannelData(1));
  return channels;
}

async function decodeWithAudioContext(file) {
  const arrayBuffer = await file.arrayBuffer();
  const audioContext = new AudioContext();
  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    return { channelData: extractChannels(audioBuffer), sampleRate: audioBuffer.sampleRate };
  } finally {
    await audioContext.close().catch(() => undefined);
  }
}

async function waitForMetadata(media) {
  if (Number.isFinite(media.duration) && media.duration > 0) return;
  await new Promise((resolve, reject) => {
    media.onloadedmetadata = resolve;
    media.onerror = () => reject(new Error('このファイルをブラウザで読み込めませんでした。'));
  });
}

// 一括デコードできないファイル向けの保険: 動画を等倍速で再生しながらPCMを取り出す。
async function captureWithPlayback(file, onProgress) {
  const url = URL.createObjectURL(file);
  const audioContext = new AudioContext();
  const media = document.createElement('video');
  media.src = url;
  media.playsInline = true;
  media.preload = 'auto';

  try {
    await waitForMetadata(media);
    const source = audioContext.createMediaElementSource(media);
    const processor = audioContext.createScriptProcessor(4096, 2, 2);
    const silence = audioContext.createGain();
    silence.gain.value = 0;

    const leftChunks = [];
    const rightChunks = [];
    processor.onaudioprocess = (event) => {
      leftChunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      rightChunks.push(new Float32Array(event.inputBuffer.getChannelData(1)));
      onProgress(media.duration ? media.currentTime / media.duration : 0);
    };

    source.connect(processor);
    processor.connect(silence);
    silence.connect(audioContext.destination);

    await audioContext.resume();
    await media.play();
    await new Promise((resolve, reject) => {
      media.onended = resolve;
      media.onerror = () => reject(new Error('再生中にエラーが発生しました。'));
    });

    processor.disconnect();
    source.disconnect();
    return { channelData: [concatFloat32(leftChunks), concatFloat32(rightChunks)], sampleRate: audioContext.sampleRate };
  } finally {
    URL.revokeObjectURL(url);
    media.remove();
    await audioContext.close().catch(() => undefined);
  }
}

async function convertFile(file, index, total) {
  if (!hasMp3Encoder()) {
    throw new Error('MP3エンコーダ（vendor/lame.min.js）を読み込めませんでした。フォルダごと保存されているか確認してください。');
  }

  const kbps = Number(bitrateSelect.value);
  const label = `${index + 1}/${total}: ${file.name}`;
  const fileProgress = (fraction) => setProgress(((index + Math.max(0, Math.min(1, fraction))) / total) * 100);

  let decoded;
  let captured = false;
  setStatus(`${label} の音声を読み込み中…`);
  try {
    decoded = await decodeWithAudioContext(file);
    fileProgress(0.1);
  } catch {
    captured = true;
    decoded = await captureWithPlayback(file, (fraction) => {
      fileProgress(fraction * 0.7);
      setStatus(`${label} の音声を取り込み中… ${Math.round(fraction * 100)}%`);
    });
  }

  const encodeStart = captured ? 0.7 : 0.1;
  const blob = await encodeToMp3(decoded.channelData, decoded.sampleRate, kbps, (fraction) => {
    fileProgress(encodeStart + fraction * (1 - encodeStart));
    setStatus(`${label} をMP3にエンコード中… ${Math.round(fraction * 100)}%`);
  });

  return { blob, name: file.name.replace(/\.(mp4|webm)$/i, '.mp3') };
}

function addDownload(result) {
  const link = document.createElement('a');
  link.className = 'download-link';
  link.href = URL.createObjectURL(result.blob);
  link.download = result.name;
  link.textContent = `${result.name} をダウンロード`;
  results.appendChild(link);
}

async function convertSelectedFiles() {
  convertButton.disabled = true;
  results.innerHTML = '';
  try {
    for (let index = 0; index < selectedFiles.length; index += 1) {
      const result = await convertFile(selectedFiles[index], index, selectedFiles.length);
      addDownload(result);
    }
    setProgress(100);
    setStatus('変換が完了しました。ダウンロードリンクから保存してください。');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    convertButton.disabled = selectedFiles.length === 0;
  }
}

fileInput.addEventListener('change', (event) => acceptFiles(event.target.files));
convertButton.addEventListener('click', convertSelectedFiles);

['dragenter', 'dragover'].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add('dragging');
  });
});

['dragleave', 'drop'].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove('dragging');
  });
});

dropZone.addEventListener('drop', (event) => acceptFiles(event.dataTransfer.files));

setStatus(hasMp3Encoder() ? 'ファイルを選択してください。' : 'MP3エンコーダを読み込めませんでした。フォルダごと保存されているか確認してください。');
