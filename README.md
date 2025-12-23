# Sherpa-ASR Russian Speech Recognition

Веб-приложение для распознавания русской речи в браузере на базе [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) WASM.

🔗 **[Демо](https://amareis.github.io/sherpa-asr-ru/)**

## Особенности

- 🎤 Распознавание речи в реальном времени прямо в браузере
- 🔒 Полностью локальная обработка - данные не отправляются на сервер
- 📦 Две модели на выбор:
  - **Vosk Zipformer (int8)** - 27MB, 16kHz, быстрая и точная
  - **T-One CTC** - 128MB, 8kHz, character-level модель
- 💾 Кэширование моделей в IndexedDB для быстрой повторной загрузки

## Быстрый старт

1. Откройте [демо](https://amareis.github.io/sherpa-asr-ru/)
2. Дождитесь загрузки модели (первый раз ~30 сек)
3. Нажмите "Start" и говорите в микрофон
4. Текст появится в реальном времени

## Технические детали

### Модели

| Модель | Размер | Sample Rate | Тип | Особенности |
|--------|--------|-------------|-----|-------------|
| Vosk Zipformer | 27MB | 16kHz | Transducer | Быстрая, точная, int8 квантизация |
| T-One CTC | 128MB | 8kHz | CTC | Character-level, без языковой модели |

### Важные нюансы

**AudioContext и Sample Rate:**
- AudioContext создаётся с частотой дискретизации модели (16kHz или 8kHz)
- Браузер делает качественный ресэмплинг с микрофона (обычно 48kHz)
- Важно установить правильный sample rate **до** создания AudioContext

**T-One CTC:**
- Требует left padding 0.3s (2400 samples) перед началом распознавания
- После reset нужно снова добавить padding
- **Важно:** аудио нужно отправлять чанками ровно по 2400 сэмплов (300ms при 8kHz)
- Character-level модель может делать орфографические ошибки без языковой модели

### Структура проекта

```
├── index.html                    # UI
├── app-asr.js                    # Логика приложения
├── sherpa-onnx-asr.js            # Конфигурация recognizer
├── sherpa-onnx-wasm-main-asr.js  # WASM runtime
├── sherpa-onnx-wasm-main-asr.wasm
├── ru-asr-vosk-i8/               # Vosk модель
│   ├── encoder.int8.onnx
│   ├── decoder.onnx
│   ├── joiner.int8.onnx
│   └── tokens.txt
└── ru-asr-t1/                    # T-One модель
    ├── model.onnx
    └── tokens.txt
```

## Локальный запуск

```bash
# Клонировать репозиторий
git clone https://github.com/Amareis/sherpa-asr-ru.git
cd sherpa-asr-ru

# Запустить локальный сервер (нужен для WASM)
python3 -m http.server 8080
# или
npx serve .

# Открыть http://localhost:8080
```

## Использование в своём проекте

```javascript
// 1. Загрузить WASM
Module = {};
Module.MountedFiles = new Map();
Module.getPreloadedPackage = () => new ArrayBuffer(0);

// 2. Загрузить файлы модели
const files = ['encoder.int8.onnx', 'decoder.onnx', 'joiner.int8.onnx', 'tokens.txt'];
for (const file of files) {
  const data = await fetch(`ru-asr-vosk-i8/${file}`).then(r => r.arrayBuffer());
  Module.FS_createDataFile('/', file, new Uint8Array(data), true, true, true);
}

// 3. Создать recognizer
const recognizer = createOnlineRecognizer(Module, 'vosk', 16000);

// 4. Обрабатывать аудио
const stream = recognizer.createStream();
stream.acceptWaveform(16000, audioSamples);
while (recognizer.isReady(stream)) {
  recognizer.decode(stream);
}
const text = recognizer.getResult(stream).text;
```

## Благодарности

- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) - ONNX runtime для speech recognition
- [Vosk](https://alphacephei.com/vosk/) - модель распознавания речи
- [T-One](https://huggingface.co/t-one) - CTC модель
