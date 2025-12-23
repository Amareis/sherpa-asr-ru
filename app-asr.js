// This file copies and modifies code
// from https://mdn.github.io/web-dictaphone/scripts/app.js
// and https://gist.github.com/meziantou/edb7217fddfbb70e899e

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const clearBtn = document.getElementById('clearBtn');
const soundClips = document.getElementById('sound-clips');
const loadModelBtn = document.getElementById('loadModelBtn');

// Ключ для localStorage
const MODEL_STORAGE_KEY = 'sherpa-asr-selected-model';

// Функция для получения выбранной модели из radio buttons
function getSelectedModel() {
  const selected = document.querySelector('input[name="modelSelect"]:checked');
  return selected ? selected.value : 'vosk';
}

// Функция для получения сохранённой модели из localStorage
function getSavedModel() {
  return localStorage.getItem(MODEL_STORAGE_KEY) || 'vosk';
}

// Функция для сохранения модели в localStorage
function saveModel(modelKey) {
  localStorage.setItem(MODEL_STORAGE_KEY, modelKey);
}

// Функция для установки выбранной модели в UI
function setSelectedModel(modelKey) {
  const radio = document.querySelector(`input[name="modelSelect"][value="${modelKey}"]`);
  if (radio) {
    radio.checked = true;
  }
}

// Функция для блокировки/разблокировки radio buttons
function setModelSelectDisabled(disabled) {
  document.querySelectorAll('input[name="modelSelect"]').forEach(radio => {
    radio.disabled = disabled;
  });
}

let textArea = document.getElementById('results');

let lastResult = '';
let resultList = [];

// Конфигурации моделей
const MODEL_CONFIGS = {
  vosk: {
    name: 'Vosk Zipformer (int8)',
    path: 'ru-asr-vosk-i8/',
    type: 'transducer',
    sampleRate: 16000,  // Vosk работает с 16kHz
    files: ['encoder.int8.onnx', 'decoder.onnx', 'joiner.int8.onnx', 'tokens.txt'],
    config: {
      encoder: 'encoder.int8.onnx',
      decoder: 'decoder.onnx',
      joiner: 'joiner.int8.onnx'
    }
  },
  t1: {
    name: 'T-One CTC',
    path: 'ru-asr-t1/',
    type: 'toneCtc',
    sampleRate: 8000,  // T-One работает с 8kHz!
    files: ['model.onnx', 'tokens.txt'],
    config: {
      model: 'model.onnx'
    }
  }
};

let currentModelType = 'vosk';  // По умолчанию Vosk

clearBtn.onclick = function() {
  resultList = [];
  textArea.value = getDisplayResult();
  textArea.scrollTop = textArea.scrollHeight;  // auto scroll
};

function getDisplayResult() {
  let i = 0;
  let ans = '';
  for (let s in resultList) {
    if (resultList[s] == '') {
      continue;
    }

    ans += '' + i + ': ' + resultList[s] + '\n';
    i += 1;
  }

  if (lastResult.length > 0) {
    ans += '' + i + ': ' + lastResult + '\n';
  }
  return ans;
}

Module = {};

// Инициализируем MountedFiles для загрузки моделей
Module.MountedFiles = new Map();

// Переопределяем getPreloadedPackage чтобы отключить загрузку .data
Module.getPreloadedPackage = function(remotePackageName, remotePackageSize) {
  console.log('[MODULE] Skipping preloaded package:', remotePackageName);
  return new ArrayBuffer(0);
};

// Функция для очистки загруженных файлов
function clearLoadedFiles() {
  console.log('[CLEAR] === Clearing loaded files ===');
  
  // Очищаем MountedFiles
  const mountedCount = Module.MountedFiles.size;
  Module.MountedFiles.clear();
  console.log(`[CLEAR] Cleared ${mountedCount} files from MountedFiles`);

  // Список файлов моделей которые нужно удалить
  const modelFiles = [
    'encoder.int8.onnx', 'decoder.onnx', 'joiner.int8.onnx',
    'encoder.onnx', 'joiner.onnx',
    'model.onnx', 'tokens.txt', 'bpe.model'
  ];

  // Удаляем файлы из Emscripten FS
  for (const file of modelFiles) {
    try {
      Module.FS.unlink('/' + file);
      console.log(`[CLEAR] ✓ Removed ${file} from FS`);
    } catch (e) {
      // Файл может не существовать - это нормально
    }
  }
  
  console.log('[CLEAR] === Cleanup complete ===');
}

// Функция для загрузки файлов выбранной модели
async function loadModelFiles(modelKey) {
  const modelConfig = MODEL_CONFIGS[modelKey];
  if (!modelConfig) {
    throw new Error(`Unknown model: ${modelKey}`);
  }

  console.log(`=== Loading model: ${modelConfig.name} ===`);
  Module.setStatus(`Loading ${modelConfig.name}...`);

  // Очищаем предыдущие файлы
  clearLoadedFiles();

  for (const file of modelConfig.files) {
    try {
      console.log(`[LOAD] Fetching ${modelConfig.path}${file}...`);
      const response = await fetch(modelConfig.path + file);

      if (!response.ok) {
        throw new Error(`Failed to load ${file}: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // Сохраняем в MountedFiles
      Module.MountedFiles.set(file, uint8Array);
      console.log(`[LOAD] ✓ Loaded ${file} (${(arrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB)`);

      // Создаем файл в виртуальной FS Emscripten
      try {
        Module.FS_createDataFile('/', file, uint8Array, true, true, true);
      } catch (fsError) {
        // Файл может уже существовать
        console.log(`[LOAD] Note: ${file} may already exist in FS`);
      }
    } catch (error) {
      console.error(`[ERROR] Failed to load ${file}:`, error);
      Module.setStatus(`Error loading ${file}: ${error.message}`);
      throw error;
    }
  }

  currentModelType = modelKey;
  console.log(`=== Model ${modelConfig.name} loaded successfully ===`);
  
  // Проверяем что все файлы загружены
  console.log('[LOAD] Verifying loaded files:');
  for (const [filename, data] of Module.MountedFiles) {
    console.log(`[LOAD]   - ${filename}: ${(data.byteLength / 1024).toFixed(1)} KB`);
  }
}

// https://emscripten.org/docs/api_reference/module.html#Module.locateFile
Module.locateFile = function(path, scriptDirectory = '') {
  console.log(`path: ${path}, scriptDirectory: ${scriptDirectory}`);
  return scriptDirectory + path;
};

// https://emscripten.org/docs/api_reference/module.html#Module.locateFile
Module.setStatus = function(status) {
  console.log(`status ${status}`);
  const statusElement = document.getElementById('status');
  if (status == 'Running...') {
    status = 'Model downloaded. Initializing recongizer...'
  }

  const downloadMatch = status.match(/Downloading data... \((\d+)\/(\d+)\)/);
  if (downloadMatch) {
    const downloaded = BigInt(downloadMatch[1]);
    const total = BigInt(downloadMatch[2]);
    const percent =
        total === 0 ? 0.00 : Number((downloaded * 10000n) / total) / 100;
    status = `Downloading data... ${percent.toFixed(2)}% (${downloadMatch[1]}/${
        downloadMatch[2]})`;
    console.log(`here ${status}`)
  }

  statusElement.textContent = status;
  if (status === '') {
    statusElement.style.display = 'none';
    // statusElement.parentNode.removeChild(statusElement);

    document.querySelectorAll('.tab-content').forEach((tabContentElement) => {
      tabContentElement.classList.remove('loading');
    });
  } else {
    statusElement.style.display = 'block';
    document.querySelectorAll('.tab-content').forEach((tabContentElement) => {
      tabContentElement.classList.add('loading');
    });
  }
};

// Флаг готовности WASM runtime
let wasmReady = false;

// Функция создания recognizer для выбранной модели
async function initRecognizerWithModel(modelKey) {
  const modelConfig = MODEL_CONFIGS[modelKey];

  console.log(`[INIT] Creating recognizer for ${modelConfig.name}...`);
  console.log(`[INIT] Model sample rate: ${modelConfig.sampleRate} Hz`);
  Module.setStatus(`Creating recognizer for ${modelConfig.name}...`);

  // Устанавливаем правильный sample rate для модели
  expectedSampleRate = modelConfig.sampleRate;
  console.log(`[INIT] Set expectedSampleRate to ${expectedSampleRate}`);

  // Освобождаем предыдущий recognizer если есть
  if (recognizer) {
    try {
      recognizer.free();
      console.log('[INIT] Previous recognizer freed');
    } catch (e) {
      console.log('[INIT] Could not free previous recognizer:', e.message);
    }
    recognizer = null;
  }

  // Освобождаем stream
  if (recognizer_stream) {
    try {
      recognizer_stream.free();
    } catch (e) {}
    recognizer_stream = null;
  }

  try {
    // Создаем recognizer с правильной конфигурацией и sample rate
    recognizer = createOnlineRecognizer(Module, modelKey, modelConfig.sampleRate);
    console.log('[INIT] ✓ Recognizer created successfully');

    startBtn.disabled = false;
    Module.setStatus('');
    console.log(`[INIT] === Ready with ${modelConfig.name} at ${modelConfig.sampleRate}Hz! ===`);
    return true;
  } catch (error) {
    console.error('[ERROR] Failed to create recognizer:', error);
    Module.setStatus('Failed to create recognizer: ' + (error.message || error));
    startBtn.disabled = true;
    return false;
  }
}

// Обработчик кнопки загрузки модели
loadModelBtn.onclick = async function() {
  const selectedModel = getSelectedModel();
  const savedModel = getSavedModel();
  
  console.log(`[UI] Load model button clicked, selected: ${selectedModel}, saved: ${savedModel}`);

  // Если выбрана другая модель - сохраняем и перезагружаем страницу
  if (selectedModel !== savedModel) {
    console.log(`[UI] Model changed from ${savedModel} to ${selectedModel}, reloading page...`);
    saveModel(selectedModel);
    location.reload();
    return;
  }

  // Если та же модель - просто перезагружаем её
  // Останавливаем запись если идет
  if (!startBtn.disabled) {
    // Запись не идет, всё ок
  } else if (!stopBtn.disabled) {
    // Запись идет, останавливаем
    stopBtn.click();
  }

  startBtn.disabled = true;
  loadModelBtn.disabled = true;
  setModelSelectDisabled(true);

  try {
    await loadModelFiles(selectedModel);
    await initRecognizerWithModel(selectedModel);
  } catch (error) {
    console.error('[ERROR] Failed to load model:', error);
    Module.setStatus('Failed to load model: ' + error.message);
  }

  loadModelBtn.disabled = false;
  setModelSelectDisabled(false);
};

Module.onRuntimeInitialized = async function() {
  console.log('=== WASM Runtime initialized! ===');
  wasmReady = true;

  // Загружаем сохранённую модель из localStorage
  const savedModel = getSavedModel();
  console.log(`[INIT] Saved model from localStorage: ${savedModel}`);
  
  // Устанавливаем правильный radio button
  setSelectedModel(savedModel);

  try {
    console.log(`[INIT] Loading model: ${savedModel}`);
    await loadModelFiles(savedModel);
    await initRecognizerWithModel(savedModel);
  } catch (error) {
    console.error('[ERROR] Failed to initialize:', error);
    Module.setStatus('Failed to initialize: ' + error.message);
  }
};

let audioCtx;
let mediaStream;

let expectedSampleRate = 16000;
let recordSampleRate;  // the sampleRate of the microphone
let recorder = null;   // the microphone
let leftchannel = [];  // TODO: Use a single channel

let recordingLength = 0;  // number of samples so far

let recognizer = null;
let recognizer_stream = null;

// Буфер для T-One модели - нужно отправлять ровно по 2400 сэмплов (300ms при 8kHz)
let t1AudioBuffer = new Float32Array(0);
const T1_CHUNK_SIZE = 2400;  // 300ms при 8kHz

if (navigator.mediaDevices.getUserMedia) {
  console.log('getUserMedia supported.');

  // see https://w3c.github.io/mediacapture-main/#dom-mediadevices-getusermedia
  const constraints = {audio: true};

  let onSuccess = function(stream) {
    if (!audioCtx) {
      audioCtx = new AudioContext({sampleRate: 16000});
    }
    console.log(audioCtx);
    recordSampleRate = audioCtx.sampleRate;
    console.log('sample rate ' + recordSampleRate);

    // creates an audio node from the microphone incoming stream
    mediaStream = audioCtx.createMediaStreamSource(stream);
    console.log('media stream', mediaStream);

    // https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/createScriptProcessor
    // bufferSize: the onaudioprocess event is called when the buffer is full
    var bufferSize = 4096;
    var numberOfInputChannels = 1;
    var numberOfOutputChannels = 2;
    if (audioCtx.createScriptProcessor) {
      recorder = audioCtx.createScriptProcessor(
          bufferSize, numberOfInputChannels, numberOfOutputChannels);
    } else {
      recorder = audioCtx.createJavaScriptNode(
          bufferSize, numberOfInputChannels, numberOfOutputChannels);
    }
    console.log('recorder', recorder);

    let audioProcessCount = 0;

    recorder.onaudioprocess = function(e) {
      audioProcessCount++;
      if (audioProcessCount % 100 === 0) {
        console.log(`[AUDIO] Processed ${audioProcessCount} audio chunks`);
      }

      let samples = new Float32Array(e.inputBuffer.getChannelData(0))
      samples = downsampleBuffer(samples, expectedSampleRate);

      if (recognizer_stream == null) {
        console.log('[STREAM] Creating new recognizer stream...');
        recognizer_stream = recognizer.createStream();
        console.log('[STREAM] ✓ Stream created');
        
        // Для T-One модели нужно добавить left padding (0.3 секунды тишины)
        // согласно C API примеру: float left_paddings[2400] = {0}; // 0.3 seconds at 8 kHz
        if (currentModelType === 't1') {
          const leftPaddingSamples = Math.floor(expectedSampleRate * 0.3); // 0.3 секунды = 2400 при 8kHz
          const leftPadding = new Float32Array(leftPaddingSamples); // заполнено нулями
          recognizer_stream.acceptWaveform(expectedSampleRate, leftPadding);
          console.log(`[STREAM] Added ${leftPaddingSamples} samples of left padding for T-One (0.3s)`);
          // Очищаем буфер
          t1AudioBuffer = new Float32Array(0);
        }
      }

      // Для T-One нужно отправлять ровно по 2400 сэмплов (300ms)
      if (currentModelType === 't1') {
        // Добавляем новые сэмплы в буфер
        const newBuffer = new Float32Array(t1AudioBuffer.length + samples.length);
        newBuffer.set(t1AudioBuffer);
        newBuffer.set(samples, t1AudioBuffer.length);
        t1AudioBuffer = newBuffer;
        
        // Отправляем чанки по 2400 сэмплов
        while (t1AudioBuffer.length >= T1_CHUNK_SIZE) {
          const chunk = t1AudioBuffer.slice(0, T1_CHUNK_SIZE);
          t1AudioBuffer = t1AudioBuffer.slice(T1_CHUNK_SIZE);
          recognizer_stream.acceptWaveform(expectedSampleRate, chunk);
        }
      } else {
        // Для других моделей отправляем как есть
        recognizer_stream.acceptWaveform(expectedSampleRate, samples);
      }

      let decodeCount = 0;
      while (recognizer.isReady(recognizer_stream)) {
        recognizer.decode(recognizer_stream);
        decodeCount++;
      }

      if (decodeCount > 0 && audioProcessCount % 50 === 0) {
        console.log(`[DECODE] Decoded ${decodeCount} frames`);
      }

      let isEndpoint = recognizer.isEndpoint(recognizer_stream);

      let result = recognizer.getResult(recognizer_stream).text;

      if (recognizer.config.modelConfig.paraformer.encoder != '') {
        let tailPaddings = new Float32Array(expectedSampleRate);
        recognizer_stream.acceptWaveform(expectedSampleRate, tailPaddings);
        while (recognizer.isReady(recognizer_stream)) {
          recognizer.decode(recognizer_stream);
        }
        result = recognizer.getResult(recognizer_stream).text;
      }

      if (result.length > 0 && lastResult != result) {
        console.log('[RESULT] New result:', result);
        lastResult = result;
      }

      if (isEndpoint) {
        console.log('[ENDPOINT] Detected endpoint');
        if (lastResult.length > 0) {
          console.log('[RESULT] Final result:', lastResult);
          resultList.push(lastResult);
          lastResult = '';
        }
        recognizer.reset(recognizer_stream);
        console.log('[STREAM] Stream reset');
        
        // После reset для T-One нужно снова добавить left padding и очистить буфер
        if (currentModelType === 't1') {
          const leftPaddingSamples = Math.floor(expectedSampleRate * 0.3);
          const leftPadding = new Float32Array(leftPaddingSamples);
          recognizer_stream.acceptWaveform(expectedSampleRate, leftPadding);
          t1AudioBuffer = new Float32Array(0);  // Очищаем буфер
          console.log(`[STREAM] Re-added left padding after reset for T-One, buffer cleared`);
        }
      }

      textArea.value = getDisplayResult();
      textArea.scrollTop = textArea.scrollHeight;  // auto scroll

      let buf = new Int16Array(samples.length);
      for (var i = 0; i < samples.length; ++i) {
        let s = samples[i];
        if (s >= 1)
          s = 1;
        else if (s <= -1)
          s = -1;

        samples[i] = s;
        buf[i] = s * 32767;
      }

      leftchannel.push(buf);
      recordingLength += bufferSize;
    };

    startBtn.onclick = function() {
      console.log('[RECORD] === Starting recording ===');
      
      // Сбрасываем stream при начале новой записи
      // чтобы избежать проблем после переключения модели
      if (recognizer_stream) {
        try {
          recognizer_stream.free();
          console.log('[RECORD] Previous stream freed');
        } catch (e) {
          console.log('[RECORD] Could not free previous stream:', e.message);
        }
        recognizer_stream = null;
      }
      
      mediaStream.connect(recorder);
      recorder.connect(audioCtx.destination);

      console.log('[RECORD] ✓ Recorder started, audio pipeline connected');
      console.log('[RECORD] Sample rate:', recordSampleRate);
      console.log('[RECORD] Expected sample rate:', expectedSampleRate);
      console.log('[RECORD] Current model:', currentModelType);

      stopBtn.disabled = false;
      startBtn.disabled = true;
    };

    stopBtn.onclick = function() {
      console.log('[RECORD] === Stopping recording ===');

      // stopBtn recording
      recorder.disconnect(audioCtx.destination);
      mediaStream.disconnect(recorder);

      console.log('[RECORD] ✓ Recorder stopped');

      startBtn.style.background = '';
      startBtn.style.color = '';
      // mediaRecorder.requestData();

      stopBtn.disabled = true;
      startBtn.disabled = false;

      var clipName = new Date().toISOString();

      const clipContainer = document.createElement('article');
      const clipLabel = document.createElement('p');
      const audio = document.createElement('audio');
      const deleteButton = document.createElement('button');
      clipContainer.classList.add('clip');
      audio.setAttribute('controls', '');
      deleteButton.textContent = 'Delete';
      deleteButton.className = 'delete';

      clipLabel.textContent = clipName;

      clipContainer.appendChild(audio);

      clipContainer.appendChild(clipLabel);
      clipContainer.appendChild(deleteButton);
      soundClips.appendChild(clipContainer);

      audio.controls = true;
      let samples = flatten(leftchannel);
      const blob = toWav(samples);

      leftchannel = [];
      const audioURL = window.URL.createObjectURL(blob);
      audio.src = audioURL;
      console.log('recorder stopped');

      deleteButton.onclick = function(e) {
        let evtTgt = e.target;
        evtTgt.parentNode.parentNode.removeChild(evtTgt.parentNode);
      };

      clipLabel.onclick = function() {
        const existingName = clipLabel.textContent;
        const newClipName = prompt('Enter a new name for your sound clip?');
        if (newClipName === null) {
          clipLabel.textContent = existingName;
        } else {
          clipLabel.textContent = newClipName;
        }
      };
    };
  };

  let onError = function(err) {
    console.log('The following error occured: ' + err);
  };

  navigator.mediaDevices.getUserMedia(constraints).then(onSuccess, onError);
} else {
  console.log('getUserMedia not supported on your browser!');
  alert('getUserMedia not supported on your browser!');
}

// this function is copied/modified from
// https://gist.github.com/meziantou/edb7217fddfbb70e899e
function flatten(listOfSamples) {
  let n = 0;
  for (let i = 0; i < listOfSamples.length; ++i) {
    n += listOfSamples[i].length;
  }
  let ans = new Int16Array(n);

  let offset = 0;
  for (let i = 0; i < listOfSamples.length; ++i) {
    ans.set(listOfSamples[i], offset);
    offset += listOfSamples[i].length;
  }
  return ans;
}

// this function is copied/modified from
// https://gist.github.com/meziantou/edb7217fddfbb70e899e
function toWav(samples) {
  let buf = new ArrayBuffer(44 + samples.length * 2);
  var view = new DataView(buf);

  // http://soundfile.sapp.org/doc/WaveFormat/
  //                   F F I R
  view.setUint32(0, 0x46464952, true);               // chunkID
  view.setUint32(4, 36 + samples.length * 2, true);  // chunkSize
  //                   E V A W
  view.setUint32(8, 0x45564157, true);  // format
                                        //
  //                      t m f
  view.setUint32(12, 0x20746d66, true);          // subchunk1ID
  view.setUint32(16, 16, true);                  // subchunk1Size, 16 for PCM
  view.setUint32(20, 1, true);                   // audioFormat, 1 for PCM
  view.setUint16(22, 1, true);                   // numChannels: 1 channel
  view.setUint32(24, expectedSampleRate, true);  // sampleRate
  view.setUint32(28, expectedSampleRate * 2, true);  // byteRate
  view.setUint16(32, 2, true);                       // blockAlign
  view.setUint16(34, 16, true);                      // bitsPerSample
  view.setUint32(36, 0x61746164, true);              // Subchunk2ID
  view.setUint32(40, samples.length * 2, true);      // subchunk2Size

  let offset = 44;
  for (let i = 0; i < samples.length; ++i) {
    view.setInt16(offset, samples[i], true);
    offset += 2;
  }

  return new Blob([view], {type: 'audio/wav'});
}

// this function is copied from
// https://github.com/awslabs/aws-lex-browser-audio-capture/blob/master/lib/worker.js#L46
function downsampleBuffer(buffer, exportSampleRate) {
  if (exportSampleRate === recordSampleRate) {
    return buffer;
  }
  var sampleRateRatio = recordSampleRate / exportSampleRate;
  var newLength = Math.round(buffer.length / sampleRateRatio);
  var result = new Float32Array(newLength);
  var offsetResult = 0;
  var offsetBuffer = 0;
  while (offsetResult < result.length) {
    var nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
    var accum = 0, count = 0;
    for (var i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }
    result[offsetResult] = accum / count;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
};
