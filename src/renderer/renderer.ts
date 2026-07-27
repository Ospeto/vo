import type { AppState, StatePayload, GeminiModelChoice } from "../shared/types.js";
import type { DictationPreset, DictationMode } from "../services/config.js";
import type { HistoryEntry } from "../services/history-service.js";

const statusDot = document.getElementById("statusDot") as HTMLElement;
const statusLabel = document.getElementById("statusLabel") as HTMLElement;
const presetSelect = document.getElementById("presetSelect") as HTMLSelectElement;
const modeSelect = document.getElementById("modeSelect") as HTMLSelectElement;
const gainSlider = document.getElementById("gainSlider") as HTMLInputElement;
const gainValue = document.getElementById("gainValue") as HTMLElement;
const meterFill = document.getElementById("meterFill") as HTMLElement;
const modelSelect = document.getElementById("modelSelect") as HTMLSelectElement;
const chimeBtn = document.getElementById("chimeBtn") as HTMLButtonElement;
const historyContainer = document.getElementById("historyContainer") as HTMLElement;
const clearHistoryBtn = document.getElementById("clearHistoryBtn") as HTMLButtonElement;
const configBtn = document.getElementById("configBtn") as HTMLButtonElement;

// Settings Modal Elements
const settingsModal = document.getElementById("settingsModal") as HTMLElement;
const closeModalBtn = document.getElementById("closeModalBtn") as HTMLButtonElement;
const keycapDisplay = document.getElementById("keycapDisplay") as HTMLElement;
const recordBtn = document.getElementById("recordBtn") as HTMLButtonElement;
const resetShortcutBtn = document.getElementById("resetShortcutBtn") as HTMLButtonElement;
const hotkeyFeedback = document.getElementById("hotkeyFeedback") as HTMLElement;
const modalPresetSelect = document.getElementById("modalPresetSelect") as HTMLSelectElement;
const vocabInput = document.getElementById("vocabInput") as HTMLInputElement;
const addVocabBtn = document.getElementById("addVocabBtn") as HTMLButtonElement;
const vocabTagsContainer = document.getElementById("vocabTagsContainer") as HTMLElement;
const geminiApiKeyInput = document.getElementById("geminiApiKeyInput") as HTMLInputElement;
const saveApiKeyBtn = document.getElementById("saveApiKeyBtn") as HTMLButtonElement;
const apiKeyFeedback = document.getElementById("apiKeyFeedback") as HTMLElement;

const chimeStartSelect = document.getElementById("chimeStartSelect") as HTMLSelectElement;
const chimeEndSelect = document.getElementById("chimeEndSelect") as HTMLSelectElement;
const previewStartChimeBtn = document.getElementById("previewStartChimeBtn") as HTMLButtonElement;
const previewEndChimeBtn = document.getElementById("previewEndChimeBtn") as HTMLButtonElement;
const symbolScannerToggle = document.getElementById("symbolScannerToggle") as HTMLInputElement;
const settingModelSelect = document.getElementById("settingModelSelect") as HTMLSelectElement;
const micDeviceSelect = document.getElementById("micDeviceSelect") as HTMLSelectElement;

const spectrumCanvas = document.getElementById("spectrumCanvas") as HTMLCanvasElement | null;
const spectrumCtx = spectrumCanvas?.getContext("2d");

let isRecordingHotkey = false;
let audioChimesEnabled = true;
let audioCtx: AudioContext | null = null;

async function populateAudioDevices(selectedDeviceId?: string) {
  if (!micDeviceSelect) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter((d) => d.kind === "audioinput");
    
    const fragment = document.createDocumentFragment();
    const defaultOption = document.createElement("option");
    defaultOption.value = "default";
    defaultOption.textContent = "System Default Microphone";
    fragment.appendChild(defaultOption);

    audioInputs.forEach((device, index) => {
      if (device.deviceId && device.deviceId !== "default") {
        const option = document.createElement("option");
        option.value = device.deviceId;
        option.textContent = device.label || `Microphone ${index + 1}`;
        fragment.appendChild(option);
      }
    });

    micDeviceSelect.innerHTML = "";
    micDeviceSelect.appendChild(fragment);
    if (selectedDeviceId) {
      micDeviceSelect.value = selectedDeviceId;
    }
  } catch {}
}
let currentPresetVocabMap: Record<string, string[]> = {};

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

function playStartChime() {
  if (!audioChimesEnabled) return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc1.type = "sine";
    osc2.type = "sine";

    osc1.frequency.setValueAtTime(587.33, now);
    osc2.frequency.setValueAtTime(880.0, now);

    gainNode.gain.setValueAtTime(0.08, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.1);
    osc2.stop(now + 0.1);
  } catch {}
}

function playBassyEndChime() {
  if (!audioChimesEnabled) return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc1.type = "sine";
    osc2.type = "triangle";

    osc1.frequency.setValueAtTime(140.0, now);
    osc2.frequency.setValueAtTime(180.0, now);

    gainNode.gain.setValueAtTime(0.1, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.14);
    osc2.stop(now + 0.14);
  } catch {}
}

function drawSpectrumFromData(freqData: number[]) {
  if (!spectrumCanvas || !spectrumCtx) return;
  spectrumCtx.clearRect(0, 0, spectrumCanvas.width, spectrumCanvas.height);

  const barCount = 20;
  const gap = 3;
  const barWidth = Math.max(2, Math.floor((spectrumCanvas.width - (barCount + 1) * gap) / barCount));
  const centerY = spectrumCanvas.height / 2;
  const maxHeight = spectrumCanvas.height - 6;

  const step = Math.floor(freqData.length / barCount) || 1;

  for (let i = 0; i < barCount; i++) {
    const rawVal = freqData[i * step] || 0;
    const barHeight = Math.max(3, Math.round((rawVal / 255) * maxHeight));
    const x = gap + i * (barWidth + gap);
    const y = centerY - barHeight / 2;

    // Clean minimal gray monochrome gradient
    const gradient = spectrumCtx.createLinearGradient(0, y, 0, y + barHeight);
    gradient.addColorStop(0, "rgba(228, 228, 231, 0.85)");
    gradient.addColorStop(0.5, "rgba(161, 161, 170, 0.65)");
    gradient.addColorStop(1, "rgba(228, 228, 231, 0.85)");

    spectrumCtx.save();
    spectrumCtx.fillStyle = gradient;

    // Draw minimal rounded center-aligned waveform bar
    if (typeof (spectrumCtx as any).roundRect === "function") {
      spectrumCtx.beginPath();
      (spectrumCtx as any).roundRect(x, y, barWidth, barHeight, Math.min(2, barWidth / 2));
      spectrumCtx.fill();
    } else {
      spectrumCtx.fillRect(x, y, barWidth, barHeight);
    }

    spectrumCtx.restore();
  }
}

function stopSpectrumVisualizer() {
  if (spectrumCanvas && spectrumCtx) {
    spectrumCtx.clearRect(0, 0, spectrumCanvas.width, spectrumCanvas.height);
  }
}

async function initUI() {
  const config = await window.electronIPC?.getConfig();
  if (config) {
    if (presetSelect) presetSelect.value = config.dictationPreset;
    if (modeSelect) modeSelect.value = config.dictationMode;
    if (modelSelect) modelSelect.value = config.geminiModel;
    if (gainSlider) {
      gainSlider.value = config.inputGain.toString();
      gainValue.textContent = `${config.inputGain.toFixed(2)}×`;
      gainSlider.setAttribute("aria-valuenow", config.inputGain.toFixed(2));
    }
    if (keycapDisplay) {
      keycapDisplay.textContent = config.keyDisplay;
    }
    audioChimesEnabled = config.audioChimesEnabled ?? true;
    updateChimeBtnUI();

    if (config.presetVocabulary) {
      currentPresetVocabMap = config.presetVocabulary as Record<string, string[]>;
    }
    if (geminiApiKeyInput && (config as any).geminiApiKey) {
      geminiApiKeyInput.value = (config as any).geminiApiKey;
    }
    if (chimeStartSelect && (config as any).chimeSoundStart) {
      chimeStartSelect.value = (config as any).chimeSoundStart;
    }
    if (chimeEndSelect && (config as any).chimeSoundEnd) {
      chimeEndSelect.value = (config as any).chimeSoundEnd;
    }
    if (symbolScannerToggle && (config as any).symbolScannerEnabled !== undefined) {
      symbolScannerToggle.checked = (config as any).symbolScannerEnabled;
    }
    if (settingModelSelect && config.geminiModel) {
      settingModelSelect.value = config.geminiModel;
    }
    await populateAudioDevices((config as any).audioDeviceId);
  }

  if (micDeviceSelect) {
    micDeviceSelect.addEventListener("change", async () => {
      await window.electronIPC?.saveConfig({ audioDeviceId: micDeviceSelect.value });
    });
  }

  const snapshot = await window.electronIPC?.getStateSnapshot();
  if (snapshot) {
    updateStatusBadge(snapshot.state, snapshot.message);
  }

  await renderHistory();
  renderVocabTags();
}

function updateChimeBtnUI() {
  if (!chimeBtn) return;
  if (audioChimesEnabled) {
    chimeBtn.classList.add("active");
    chimeBtn.title = "Audio Chimes: Enabled";
  } else {
    chimeBtn.classList.remove("active");
    chimeBtn.title = "Audio Chimes: Muted";
  }
}

function renderVocabTags() {
  if (!vocabTagsContainer || !modalPresetSelect) return;
  const currentPreset = modalPresetSelect.value;
  const terms = currentPresetVocabMap[currentPreset] || [];
  vocabTagsContainer.innerHTML = "";

  if (terms.length === 0) {
    vocabTagsContainer.innerHTML = `<span class="vocab-tag-empty">No vocabulary terms for ${currentPreset}</span>`;
    return;
  }

  terms.forEach((term, index) => {
    const tag = document.createElement("span");
    tag.className = "vocab-tag";
    tag.innerHTML = `${term} <button data-index="${index}" title="Remove term">&times;</button>`;
    tag.querySelector("button")?.addEventListener("click", async () => {
      await removeVocabTerm(currentPreset, index);
    });
    vocabTagsContainer.appendChild(tag);
  });
}

async function addVocabTerm(preset: string, term: string) {
  const cleanTerm = term.trim();
  if (!cleanTerm) return;

  const list = currentPresetVocabMap[preset] || [];
  if (!list.includes(cleanTerm)) {
    list.push(cleanTerm);
    currentPresetVocabMap[preset] = list;
    await window.electronIPC?.saveConfig({ presetVocabulary: currentPresetVocabMap });
    renderVocabTags();
  }
  if (vocabInput) vocabInput.value = "";
}

async function removeVocabTerm(preset: string, index: number) {
  const list = currentPresetVocabMap[preset] || [];
  if (index >= 0 && index < list.length) {
    list.splice(index, 1);
    currentPresetVocabMap[preset] = list;
    await window.electronIPC?.saveConfig({ presetVocabulary: currentPresetVocabMap });
    renderVocabTags();
  }
}

async function renderHistory() {
  const historyContainer = document.getElementById("historyContainer");
  const monthlyCostBadge = document.getElementById("monthlyCostBadge");
  if (!historyContainer) return;

  const history: HistoryEntry[] = (await window.electronIPC?.getHistory()) || [];

  let totalCost = 0;
  history.forEach((item: any) => {
    totalCost += item.cost || 0;
  });
  if (monthlyCostBadge) {
    monthlyCostBadge.textContent = `Month: $${totalCost.toFixed(5)}`;
  }

  if (history.length === 0) {
    historyContainer.innerHTML = '<div class="history-empty">No recent dictations</div>';
    return;
  }

  const fragment = document.createDocumentFragment();
  history.forEach((item: HistoryEntry) => {
    const el = document.createElement("div");
    el.className = "history-item";

    const textEl = document.createElement("div");
    textEl.className = "history-text";
    textEl.textContent = item.text;

    const metaEl = document.createElement("div");
    metaEl.className = "history-meta";

    const parsedDate = typeof item.timestamp === "number"
      ? new Date(item.timestamp)
      : new Date(Date.parse(String(item.timestamp || "")) || Date.now());

    const timeStr = isNaN(parsedDate.getTime())
      ? "Just now"
      : parsedDate.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });

    const itemCostStr = (item as any).cost !== undefined ? ` · $${(item as any).cost.toFixed(6)}` : "";
    metaEl.textContent = `${timeStr} · ${item.activeApp || "App"}${itemCostStr}`;

    el.appendChild(textEl);
    el.appendChild(metaEl);
    fragment.appendChild(el);
  });

  historyContainer.innerHTML = "";
  historyContainer.appendChild(fragment);
}

window.electronIPC?.onStateChanged((payload: StatePayload) => {
  if (payload.state === "recording") {
    playStartChime();
  } else if (payload.state === "stopping" || payload.state === "transcribing" || payload.state === "idle") {
    stopSpectrumVisualizer();
    if (payload.state === "idle" && payload.message?.startsWith("Dictated:")) {
      playBassyEndChime();
      renderHistory();
    }
  }
  updateStatusBadge(payload.state, payload.message);
});

window.electronIPC?.onAudioLevelUpdate((payload: number | { level: number; spectrum?: number[] }) => {
  const level = typeof payload === "number" ? payload : payload.level;
  const spectrum = typeof payload === "object" ? payload.spectrum : undefined;

  if (meterFill) {
    meterFill.style.width = `${level}%`;
  }

  if (spectrum && spectrum.length > 0) {
    drawSpectrumFromData(spectrum);
  }
});

function updateStatusBadge(state: AppState, message?: string) {
  if (!statusDot || !statusLabel) return;

  switch (state) {
    case "idle":
      statusDot.style.backgroundColor = "#10b981";
      if (message && message.startsWith("Dictated:")) {
        statusLabel.textContent = "Dictated & Pasted";
      } else {
        statusLabel.textContent = message || "Ready";
      }
      enableControls(true);
      break;
    case "starting":
    case "recording":
      statusDot.style.backgroundColor = "#f43f5e";
      statusLabel.textContent = message || "Listening...";
      enableControls(false);
      break;
    case "stopping":
    case "transcribing":
    case "thinking":
    case "speaking":
      statusDot.style.backgroundColor = "#f59e0b";
      statusLabel.textContent = message || "Processing...";
      enableControls(false);
      break;
    case "error":
      statusDot.style.backgroundColor = "#ef4444";
      statusLabel.textContent = message || "Error";
      enableControls(true);
      break;
  }
}

function enableControls(enabled: boolean) {
  if (presetSelect) presetSelect.disabled = !enabled;
  if (modeSelect) modeSelect.disabled = !enabled;
  gainSlider.disabled = !enabled;
  modelSelect.disabled = !enabled;
  if (recordBtn) recordBtn.disabled = !enabled;
  configBtn.disabled = !enabled;
}

presetSelect?.addEventListener("change", async () => {
  const selectedPreset = presetSelect.value as DictationPreset;
  await window.electronIPC?.saveConfig({ dictationPreset: selectedPreset });
});

modeSelect?.addEventListener("change", async () => {
  const selectedMode = modeSelect.value as DictationMode;
  await window.electronIPC?.saveConfig({ dictationMode: selectedMode });
});

gainSlider?.addEventListener("input", () => {
  const val = parseFloat(gainSlider.value);
  gainValue.textContent = `${val.toFixed(2)}×`;
  gainSlider.setAttribute("aria-valuenow", val.toFixed(2));
});

gainSlider?.addEventListener("change", async () => {
  const val = parseFloat(gainSlider.value);
  await window.electronIPC?.saveConfig({ inputGain: val });
});

modelSelect?.addEventListener("change", async () => {
  const selectedModel = modelSelect.value as GeminiModelChoice;
  if (settingModelSelect) settingModelSelect.value = selectedModel;
  await window.electronIPC?.saveConfig({ geminiModel: selectedModel });
});

settingModelSelect?.addEventListener("change", async () => {
  const selectedModel = settingModelSelect.value as GeminiModelChoice;
  if (modelSelect) modelSelect.value = selectedModel;
  await window.electronIPC?.saveConfig({ geminiModel: selectedModel });
});

chimeBtn?.addEventListener("click", async () => {
  audioChimesEnabled = !audioChimesEnabled;
  updateChimeBtnUI();
  if (audioChimesEnabled) {
    playBassyEndChime();
  }
  await window.electronIPC?.saveConfig({ audioChimesEnabled });
});

clearHistoryBtn?.addEventListener("click", async () => {
  await window.electronIPC?.clearHistory();
  await renderHistory();
});

configBtn?.addEventListener("click", () => {
  if (settingsModal) {
    settingsModal.classList.remove("hidden");
    renderVocabTags();
  }
});

closeModalBtn?.addEventListener("click", () => {
  if (settingsModal) {
    settingsModal.classList.add("hidden");
  }
});

modalPresetSelect?.addEventListener("change", () => {
  renderVocabTags();
});

addVocabBtn?.addEventListener("click", () => {
  if (vocabInput && modalPresetSelect) {
    addVocabTerm(modalPresetSelect.value, vocabInput.value);
  }
});

vocabInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && vocabInput && modalPresetSelect) {
    e.preventDefault();
    addVocabTerm(modalPresetSelect.value, vocabInput.value);
  }
});

const testApiKeyBtn = document.getElementById("testApiKeyBtn") as HTMLButtonElement;

testApiKeyBtn?.addEventListener("click", async () => {
  const keyVal = geminiApiKeyInput?.value ? geminiApiKeyInput.value.trim() : undefined;
  if (apiKeyFeedback) {
    apiKeyFeedback.textContent = "Testing API Key...";
    apiKeyFeedback.style.color = "#3b82f6";
    apiKeyFeedback.style.display = "block";
  }
  const res = await (window.electronIPC as any)?.testApiKey(keyVal);
  if (apiKeyFeedback) {
    if (res?.success) {
      apiKeyFeedback.textContent = `✓ ${res.message || "API Key is valid!"}`;
      apiKeyFeedback.style.color = "#10b981";
    } else {
      apiKeyFeedback.textContent = `✕ ${res?.error || "Invalid API Key"}`;
      apiKeyFeedback.style.color = "#ef4444";
    }
    apiKeyFeedback.style.display = "block";
  }
});

saveApiKeyBtn?.addEventListener("click", async () => {
  const keyVal = geminiApiKeyInput?.value ? geminiApiKeyInput.value.trim() : "";
  await window.electronIPC?.saveConfig({ geminiApiKey: keyVal });
  if (apiKeyFeedback) {
    apiKeyFeedback.textContent = keyVal ? "✓ Gemini API Key saved!" : "API Key cleared.";
    apiKeyFeedback.style.color = keyVal ? "#10b981" : "#ef4444";
    apiKeyFeedback.style.display = "block";
    setTimeout(() => {
      apiKeyFeedback.style.display = "none";
    }, 2500);
  }
});

chimeStartSelect?.addEventListener("change", async () => {
  await window.electronIPC?.saveConfig({ chimeSoundStart: chimeStartSelect.value as any });
});

chimeEndSelect?.addEventListener("change", async () => {
  await window.electronIPC?.saveConfig({ chimeSoundEnd: chimeEndSelect.value as any });
});

symbolScannerToggle?.addEventListener("change", async () => {
  await window.electronIPC?.saveConfig({ symbolScannerEnabled: symbolScannerToggle.checked });
});

previewStartChimeBtn?.addEventListener("click", async () => {
  await (window.electronIPC as any)?.previewChime(chimeStartSelect.value);
});

previewEndChimeBtn?.addEventListener("click", async () => {
  await (window.electronIPC as any)?.previewChime(chimeEndSelect.value);
});

resetShortcutBtn?.addEventListener("click", async () => {
  const res = await window.electronIPC?.registerHotkey("ctrl+cmd+option+v");
  if (res?.success) {
    keycapDisplay.textContent = res.keyDisplay || "⌃⌥⌘V";
    hideHotkeyError();
  }
});

recordBtn?.addEventListener("click", () => {
  if (!isRecordingHotkey) {
    startHotkeyRecording();
  } else {
    stopHotkeyRecording();
  }
});

function startHotkeyRecording() {
  isRecordingHotkey = true;
  recordBtn.textContent = "Record";
  keycapDisplay.textContent = "Press shortcut...";
  hideHotkeyError();

  const handleKeyDown = async (e: KeyboardEvent) => {
    e.preventDefault();
    if (e.key === "Escape") {
      stopHotkeyRecording();
      window.removeEventListener("keydown", handleKeyDown);
      return;
    }

    const modifiers: string[] = [];
    if (e.ctrlKey) modifiers.push("ctrl");
    if (e.metaKey) modifiers.push("cmd");
    if (e.altKey) modifiers.push("option");
    if (e.shiftKey) modifiers.push("shift");

    const isModifierKey = ["Control", "Meta", "Alt", "Shift"].includes(e.key);
    if (!isModifierKey) {
      const keyStr = [...modifiers, e.key.toLowerCase()].join("+");
      const res = await window.electronIPC?.registerHotkey(keyStr);
      if (res?.success) {
        keycapDisplay.textContent = res.keyDisplay || keyStr;
        hideHotkeyError();
      } else if (res?.error) {
        showHotkeyError(res.error);
      }
      stopHotkeyRecording();
      window.removeEventListener("keydown", handleKeyDown);
    }
  };

  window.addEventListener("keydown", handleKeyDown);
}

function stopHotkeyRecording() {
  isRecordingHotkey = false;
  recordBtn.textContent = "Record";
}

function showHotkeyError(msg: string) {
  if (hotkeyFeedback) {
    hotkeyFeedback.textContent = msg;
    hotkeyFeedback.style.display = "block";
  }
}

function hideHotkeyError() {
  if (hotkeyFeedback) {
    hotkeyFeedback.style.display = "none";
  }
}

initUI();
