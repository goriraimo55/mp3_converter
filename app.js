const fileInput = document.querySelector('#file-input');
const dropZone = document.querySelector('#drop-zone');
const convertButton = document.querySelector('#convert-button');
const bitrateSelect = document.querySelector('#bitrate-select');
const statusBox = document.querySelector('#status');
const progressBar = document.querySelector('#progress-bar');
const fileList = document.querySelector('#file-list');
const results = document.querySelector('#results');

let selectedFiles = [];

const MP3_TYPES = ['audio/mpeg', 'audio/mp3'];

function supportedMp3Type() {
  if (!window.MediaRecorder) return '';
  return MP3_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) || '';
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

async function waitForMetadata(media) {
  if (Number.isFinite(media.duration) && media.duration > 0) return;
  await new Promise((resolve, reject) => {
    media.onloadedmetadata = resolve;
    media.onerror = () => reject(new Error('このファイルをブラウザで読み込めませんでした。'));
  });
}

async function convertFile(file, index, total) {
  const mimeType = supportedMp3Type();
  if (!mimeType) {
    throw new Error('このブラウザはMP3録音（audio/mpeg）に対応していません。対応ブラウザで開いてください。');
  }

  const url = URL.createObjectURL(file);
  const audioContext = new AudioContext();
  const media = document.createElement('video');
  media.src = url;
  media.muted = true;
  media.playsInline = true;
  media.crossOrigin = 'anonymous';

  try {
    await waitForMetadata(media);
    const destination = audioContext.createMediaStreamDestination();
    const source = audioContext.createMediaElementSource(media);
    source.connect(destination);

    const chunks = [];
    const recorder = new MediaRecorder(destination.stream, {
      mimeType,
      audioBitsPerSecond: Number(bitrateSelect.value) * 1000,
    });

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size) chunks.push(event.data);
    };

    const finished = new Promise((resolve, reject) => {
      recorder.onstop = resolve;
      recorder.onerror = () => reject(new Error('録音中にエラーが発生しました。'));
      media.onerror = () => reject(new Error('再生中にエラーが発生しました。'));
      media.onended = () => {
        if (recorder.state !== 'inactive') recorder.stop();
      };
    });

    await audioContext.resume();
    recorder.start(1000);
    await media.play();

    const timer = setInterval(() => {
      const fileProgress = media.duration ? (media.currentTime / media.duration) * 100 : 0;
      setProgress(((index + fileProgress / 100) / total) * 100);
      setStatus(`${index + 1}/${total}: ${file.name} を変換中… ${Math.round(fileProgress)}%`);
    }, 250);

    await finished;
    clearInterval(timer);

    const blob = new Blob(chunks, { type: mimeType });
    return { blob, name: file.name.replace(/\.(mp4|webm)$/i, '.mp3') };
  } finally {
    URL.revokeObjectURL(url);
    media.remove();
    await audioContext.close().catch(() => undefined);
  }
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

setStatus(supportedMp3Type() ? 'ファイルを選択してください。' : 'このブラウザはMP3録音に未対応の可能性があります。');
