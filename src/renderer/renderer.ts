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
const translateToggleBtn = document.getElementById("translateToggleBtn") as HTMLButtonElement;

// Settings Modal Elements
const settingsModal = document.getElementById("settingsModal") as HTMLElement;
const closeModalBtn = document.getElementById("closeModalBtn") as HTMLButtonElement;
const keycapDisplay = document.getElementById("keycapDisplay") as HTMLElement;
const recordBtn = document.getElementById("recordBtn") as HTMLButtonElement;
const resetShortcutBtn = document.getElementById("resetShortcutBtn") as HTMLButtonElement;
const hotkeyFeedback = document.getElementById("hotkeyFeedback") as HTMLElement;

const editKeycapDisplay = document.getElementById("editKeycapDisplay") as HTMLElement;
const recordEditBtn = document.getElementById("recordEditBtn") as HTMLButtonElement;
const resetEditShortcutBtn = document.getElementById("resetEditShortcutBtn") as HTMLButtonElement;
const editHotkeyFeedback = document.getElementById("editHotkeyFeedback") as HTMLElement;

const modalPresetSelect = document.getElementById("modalPresetSelect") as HTMLSelectElement;
const targetLanguageSelect = document.getElementById("targetLanguageSelect") as HTMLSelectElement;
const vocabInput = document.getElementById("vocabInput") as HTMLInputElement;
const addVocabBtn = document.getElementById("addVocabBtn") as HTMLButtonElement;
const vocabTagsContainer = document.getElementById("vocabTagsContainer") as HTMLElement;

const personNameInput = document.getElementById("personNameInput") as HTMLInputElement;
const addPersonNameBtn = document.getElementById("addPersonNameBtn") as HTMLButtonElement;
const personNamesContainer = document.getElementById("personNamesContainer") as HTMLElement;
const personNamesCountBadge = document.getElementById("personNamesCountBadge") as HTMLElement;

let currentCustomVocab: string[] = [];
const geminiApiKey1Input = document.getElementById("geminiApiKey1Input") as HTMLInputElement;
const geminiApiKey2Input = document.getElementById("geminiApiKey2Input") as HTMLInputElement;
const geminiApiKey3Input = document.getElementById("geminiApiKey3Input") as HTMLInputElement;
const saveApiKeyBtn = document.getElementById("saveApiKeyBtn") as HTMLButtonElement;
const apiKeyFeedback = document.getElementById("apiKeyFeedback") as HTMLElement;

const geminiFallbackApiKeyInput = document.getElementById("geminiFallbackApiKeyInput") as HTMLInputElement;
const saveFallbackApiKeyBtn = document.getElementById("saveFallbackApiKeyBtn") as HTMLButtonElement;
const fallbackApiKeyFeedback = document.getElementById("fallbackApiKeyFeedback") as HTMLElement;

const chimeStartSelect = document.getElementById("chimeStartSelect") as HTMLSelectElement;
const chimeEndSelect = document.getElementById("chimeEndSelect") as HTMLSelectElement;
const previewStartChimeBtn = document.getElementById("previewStartChimeBtn") as HTMLButtonElement;
const previewEndChimeBtn = document.getElementById("previewEndChimeBtn") as HTMLButtonElement;
const symbolScannerToggle = document.getElementById("symbolScannerToggle") as HTMLInputElement;
const settingModelSelect = document.getElementById("settingModelSelect") as HTMLSelectElement;
const micDeviceSelect = document.getElementById("micDeviceSelect") as HTMLSelectElement;

const appRulesContainer = document.getElementById("appRulesContainer") as HTMLElement;
const appRulesCountBadge = document.getElementById("appRulesCountBadge") as HTMLElement;
const newAppNameInput = document.getElementById("newAppNameInput") as HTMLInputElement;
const newAppPresetSelect = document.getElementById("newAppPresetSelect") as HTMLSelectElement;
const addAppRuleBtn = document.getElementById("addAppRuleBtn") as HTMLButtonElement;

let currentAppMappings: Record<string, string> = {};

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

function playMechanicalClickSound() {
  if (!audioChimesEnabled) return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // 1. High-frequency tactile click transient (rapid pitch drop)
    const clickOsc = ctx.createOscillator();
    const clickGain = ctx.createGain();

    clickOsc.type = "triangle";
    clickOsc.frequency.setValueAtTime(1400, now);
    clickOsc.frequency.exponentialRampToValueAtTime(350, now + 0.015);

    clickGain.gain.setValueAtTime(0.18, now);
    clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.018);

    clickOsc.connect(clickGain);
    clickGain.connect(ctx.destination);

    clickOsc.start(now);
    clickOsc.stop(now + 0.02);

    // 2. Mechanical switch housing bottom-out thock resonance
    const thockOsc = ctx.createOscillator();
    const thockGain = ctx.createGain();

    thockOsc.type = "sine";
    thockOsc.frequency.setValueAtTime(750, now + 0.003);
    thockOsc.frequency.exponentialRampToValueAtTime(220, now + 0.035);

    thockGain.gain.setValueAtTime(0.12, now + 0.003);
    thockGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

    thockOsc.connect(thockGain);
    thockGain.connect(ctx.destination);

    thockOsc.start(now + 0.003);
    thockOsc.stop(now + 0.045);
  } catch {}
}

let animationFrameId: number | null = null;
let currentTargetAmp = 0;
let smoothedAmp = 0;
let wavePhase = 0;

let idleFrameCount = 0;

function startWaveAnimationLoop() {
  if (animationFrameId !== null) return;

  function renderWave() {
    if (!spectrumCanvas || !spectrumCtx) {
      animationFrameId = null;
      return;
    }

    // Snappy attack and decay damping
    smoothedAmp += (currentTargetAmp - smoothedAmp) * 0.24;

    const width = spectrumCanvas.width;
    const height = spectrumCanvas.height;
    const centerY = height / 2;
    const maxAmp = height / 2 - 2;

    const rawRatio = Math.max(0, smoothedAmp / 100);
    const activeAmp = rawRatio < 0.02 ? 0 : Math.min(maxAmp, rawRatio * maxAmp * 1.4);

    if (activeAmp > 0) {
      wavePhase += 0.08 + rawRatio * 0.16;
    }

    spectrumCtx.clearRect(0, 0, width, height);

    if (activeAmp > 0.05) {
      idleFrameCount = 0;
      const numLines = 6;
      for (let i = 0; i < numLines; i++) {
        spectrumCtx.save();
        spectrumCtx.beginPath();

        const offsetFactor = (i - (numLines - 1) / 2) * 0.22;
        const phaseShift = wavePhase + i * 0.28;
        const freqMult = 3.5 + (i % 2 === 0 ? 0.6 : -0.4);

        for (let x = 0; x <= width; x += 2) {
          const progress = x / width;
          const envelope = Math.sin(progress * Math.PI);
          const y = centerY + Math.sin(progress * Math.PI * freqMult + phaseShift) * (activeAmp + offsetFactor * 8) * envelope;

          if (x === 0) spectrumCtx.moveTo(x, y);
          else spectrumCtx.lineTo(x, y);
        }

        const alpha = Math.max(0.2, 1.0 - Math.abs(offsetFactor) * 1.2);
        if (i % 2 === 1) {
          spectrumCtx.setLineDash([4, 3]);
        } else {
          spectrumCtx.setLineDash([]);
        }

        const gradient = spectrumCtx.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, `rgba(59, 130, 246, ${alpha * 0.65})`);
        gradient.addColorStop(0.5, `rgba(52, 211, 153, ${alpha})`);
        gradient.addColorStop(1, `rgba(59, 130, 246, ${alpha * 0.65})`);

        spectrumCtx.strokeStyle = gradient;
        spectrumCtx.lineWidth = i === 2 || i === 3 ? Math.min(3.2, 1.8 + rawRatio * 2) : 1.2;
        spectrumCtx.lineCap = "round";
        spectrumCtx.stroke();
        spectrumCtx.restore();
      }
    } else {
      // Complete Silence / Mic Gain 0: Clean stationary baseline
      spectrumCtx.save();
      spectrumCtx.beginPath();
      spectrumCtx.moveTo(0, centerY);
      spectrumCtx.lineTo(width, centerY);
      spectrumCtx.strokeStyle = "rgba(161, 161, 170, 0.2)";
      spectrumCtx.lineWidth = 1;
      spectrumCtx.stroke();
      spectrumCtx.restore();

      idleFrameCount++;
      if (idleFrameCount > 60 && currentTargetAmp < 0.05) {
        animationFrameId = null;
        return; // Throttles rendering when silent
      }
    }

    animationFrameId = requestAnimationFrame(renderWave);
  }

  animationFrameId = requestAnimationFrame(renderWave);
}

function updateAudioWaveLevel(level: number) {
  currentTargetAmp = level;
  startWaveAnimationLoop();
}

function stopSpectrumVisualizer() {
  currentTargetAmp = 0;
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  if (spectrumCanvas && spectrumCtx) {
    spectrumCtx.clearRect(0, 0, spectrumCanvas.width, spectrumCanvas.height);
  }
}

function updatePresetPills(selectedPreset: string) {
  const btns = document.querySelectorAll(".preset-pill-btn");
  btns.forEach((btn) => {
    const p = btn.getAttribute("data-preset");
    if (p === selectedPreset) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
}

function updateModelPills(selectedModel: string) {
  const btns = document.querySelectorAll(".model-pill-btn");
  const badge = document.getElementById("modelLevelLabel");
  btns.forEach((btn) => {
    const m = btn.getAttribute("data-model");
    if (m === selectedModel) {
      btn.classList.add("active");
      if (badge) {
        badge.textContent = btn.getAttribute("data-label") || selectedModel;
      }
    } else {
      btn.classList.remove("active");
    }
  });
}

async function initUI() {
  const config = await window.electronIPC?.getConfig();
  if (config) {
    updatePresetPills(config.dictationPreset || "careful");
    updateModelPills(config.geminiModel || "gemini-3.6-flash");
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
    if (editKeycapDisplay && (config as any).editKeyDisplay) {
      editKeycapDisplay.textContent = (config as any).editKeyDisplay;
    }
    audioChimesEnabled = config.audioChimesEnabled ?? true;
    updateChimeBtnUI();
    translateEnabled = config.translateEnabled ?? false;
    updateTranslateBtnUI();
    if (targetLanguageSelect && config.targetLanguage) {
      targetLanguageSelect.value = config.targetLanguage;
    }

    if ((config as any).customVocabulary) {
      currentCustomVocab = [...((config as any).customVocabulary as string[])];
    }
    if (config.presetVocabulary) {
      currentPresetVocabMap = config.presetVocabulary as Record<string, string[]>;
    }
    if ((config as any).appPresetMappings) {
      currentAppMappings = { ...(config as any).appPresetMappings };
    }
    if ((config as any).geminiApiKey) {
      const keys = String((config as any).geminiApiKey).split(/[,\n]+/).map((k) => k.trim());
      if (geminiApiKey1Input && keys[0]) geminiApiKey1Input.value = keys[0];
      if (geminiApiKey2Input && keys[1]) geminiApiKey2Input.value = keys[1];
      if (geminiApiKey3Input && keys[2]) geminiApiKey3Input.value = keys[2];
    }
    if (geminiFallbackApiKeyInput && (config as any).geminiFallbackApiKey) {
      geminiFallbackApiKeyInput.value = (config as any).geminiFallbackApiKey;
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
    renderAppRules();
    renderPersonNames();
    renderVocabTags();
    await renderHistory();
  }

  if (micDeviceSelect) {
    micDeviceSelect.addEventListener("change", async () => {
      await window.electronIPC?.saveConfig({ audioDeviceId: micDeviceSelect.value });
    });
  }

  if (addAppRuleBtn) {
    addAppRuleBtn.addEventListener("click", async () => {
      const name = newAppNameInput?.value.trim().toLowerCase();
      const preset = newAppPresetSelect?.value;
      if (name && preset) {
        currentAppMappings[name] = preset;
        if (newAppNameInput) newAppNameInput.value = "";
        renderAppRules();
        await window.electronIPC?.saveConfig({ appPresetMappings: currentAppMappings });
      }
    });
  }

  const snapshot = await window.electronIPC?.getStateSnapshot();
  if (snapshot) {
    updateStatusBadge(snapshot.state, snapshot.message);
  }

  await renderHistory();
  renderVocabTags();
}

function renderAppRules() {
  if (!appRulesContainer) return;
  appRulesContainer.innerHTML = "";

  const keys = Object.keys(currentAppMappings);
  if (appRulesCountBadge) {
    appRulesCountBadge.textContent = `${keys.length} Rules`;
  }

  if (keys.length === 0) {
    appRulesContainer.innerHTML = `<span style="font-size: 10.5px; color: #71717a;">No app rules configured.</span>`;
    return;
  }

  const fragment = document.createDocumentFragment();
  keys.forEach((appName) => {
    const mappedPreset = currentAppMappings[appName];
    const row = document.createElement("div");
    row.style.cssText = "display: flex; align-items: center; justify-content: space-between; background: rgba(255, 255, 255, 0.04); padding: 4px 8px; border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.08); font-size: 11px;";

    const nameSpan = document.createElement("span");
    nameSpan.style.cssText = "font-weight: 500; color: #e4e4e7;";
    nameSpan.textContent = appName;

    const rightGroup = document.createElement("div");
    rightGroup.style.cssText = "display: flex; align-items: center; gap: 6px;";

    const select = document.createElement("select");
    select.className = "chime-select";
    select.style.cssText = "font-size: 10px; padding: 2px 4px;";
    select.innerHTML = `
      <option value="careful" ${mappedPreset === "careful" ? "selected" : ""}>Conversation</option>
      <option value="code_comment" ${mappedPreset === "code_comment" ? "selected" : ""}>Coding</option>
    `;

    select.addEventListener("change", async () => {
      currentAppMappings[appName] = select.value as any;
      await window.electronIPC?.saveConfig({ appPresetMappings: currentAppMappings });
    });

    const delBtn = document.createElement("button");
    delBtn.className = "link-btn-danger";
    delBtn.style.cssText = "font-size: 10px; padding: 2px;";
    delBtn.textContent = "✕";
    delBtn.title = "Delete Rule";
    delBtn.addEventListener("click", async () => {
      delete currentAppMappings[appName];
      renderAppRules();
      await window.electronIPC?.saveConfig({ appPresetMappings: currentAppMappings });
    });

    rightGroup.appendChild(select);
    rightGroup.appendChild(delBtn);
    row.appendChild(nameSpan);
    row.appendChild(rightGroup);
    fragment.appendChild(row);
  });

  appRulesContainer.appendChild(fragment);
}

let translateEnabled = false;

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

function updateTranslateBtnUI() {
  if (!translateToggleBtn) return;
  if (translateEnabled) {
    translateToggleBtn.classList.add("translate-active");
    translateToggleBtn.title = "Auto-Translation: Enabled";
  } else {
    translateToggleBtn.classList.remove("translate-active");
    translateToggleBtn.title = "Auto-Translation: Disabled";
  }
}

function renderPersonNames() {
  if (!personNamesContainer) return;
  personNamesContainer.innerHTML = "";

  if (personNamesCountBadge) {
    personNamesCountBadge.textContent = `${currentCustomVocab.length} Names`;
  }

  if (currentCustomVocab.length === 0) {
    personNamesContainer.innerHTML = `<span class="vocab-tag-empty">No person names added yet</span>`;
    return;
  }

  currentCustomVocab.forEach((term, index) => {
    const tag = document.createElement("span");
    tag.className = "vocab-tag";
    tag.style.borderColor = "rgba(59, 130, 246, 0.4)";
    tag.style.background = "rgba(59, 130, 246, 0.15)";
    tag.style.color = "#93c5fd";
    tag.innerHTML = `${term} <button data-index="${index}" title="Remove name">&times;</button>`;
    tag.querySelector("button")?.addEventListener("click", async () => {
      await removePersonName(index);
    });
    personNamesContainer.appendChild(tag);
  });
}

async function addPersonName(name: string) {
  const cleanName = name.trim();
  if (!cleanName) return;

  if (!currentCustomVocab.includes(cleanName)) {
    currentCustomVocab.push(cleanName);
    await window.electronIPC?.saveConfig({ customVocabulary: currentCustomVocab });
    renderPersonNames();
  }
  if (personNameInput) personNameInput.value = "";
}

async function removePersonName(index: number) {
  if (index >= 0 && index < currentCustomVocab.length) {
    currentCustomVocab.splice(index, 1);
    await window.electronIPC?.saveConfig({ customVocabulary: currentCustomVocab });
    renderPersonNames();
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
  if (!historyContainer) return;

  const history: HistoryEntry[] = (await window.electronIPC?.getHistory()) || [];

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

    metaEl.innerHTML = `${timeStr} · ${item.activeApp || "App"}`;

    el.title = "Click to copy text to clipboard";
    el.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(item.text);
        const originalMeta = metaEl.innerHTML;
        metaEl.innerHTML = `<span style="color: #34d399; font-weight: 600;">✓ Copied to clipboard!</span>`;
        setTimeout(() => {
          metaEl.innerHTML = originalMeta;
        }, 1200);
      } catch (err) {
        console.error("Failed to copy history item:", err);
      }
    });

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
    if (payload.state === "idle") {
      if (payload.message?.startsWith("Dictated:") || payload.message?.includes("Key:")) {
        playBassyEndChime();
      }
      renderHistory();
    }
  }
  updateStatusBadge(payload.state, payload.message);
});

window.electronIPC?.onAudioLevelUpdate((payload: number | { level: number; spectrum?: number[] }) => {
  const level = typeof payload === "number" ? payload : payload.level;

  if (meterFill) {
    meterFill.style.width = `${level}%`;
  }
  updateAudioWaveLevel(level);
});

function updateStatusBadge(state: AppState, message?: string) {
  if (!statusDot || !statusLabel) return;

  const containerEl = document.querySelector(".container");
  if (state === "recording" || state === "starting") {
    containerEl?.classList.add("recording-pulse");
  } else {
    containerEl?.classList.remove("recording-pulse");
  }

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
  document.querySelectorAll<HTMLButtonElement>(".preset-pill-btn").forEach((btn) => {
    btn.disabled = !enabled;
  });
  document.querySelectorAll<HTMLButtonElement>(".model-pill-btn").forEach((btn) => {
    btn.disabled = !enabled;
  });
  if (modeSelect) modeSelect.disabled = !enabled;
  gainSlider.disabled = !enabled;
  if (modelSelect) modelSelect.disabled = !enabled;
  if (recordBtn) recordBtn.disabled = !enabled;
  configBtn.disabled = !enabled;
}

document.querySelectorAll(".preset-pill-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    playMechanicalClickSound();
    const selectedPreset = btn.getAttribute("data-preset") as DictationPreset;
    if (!selectedPreset) return;
    updatePresetPills(selectedPreset);
    if (presetSelect) presetSelect.value = selectedPreset;
    await window.electronIPC?.saveConfig({ dictationPreset: selectedPreset });
  });
});

document.querySelectorAll(".model-pill-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    playMechanicalClickSound();
    const selectedModel = btn.getAttribute("data-model");
    if (!selectedModel) return;
    updateModelPills(selectedModel);
    if (modelSelect) modelSelect.value = selectedModel;
    if (settingModelSelect) settingModelSelect.value = selectedModel;
    await window.electronIPC?.saveConfig({ geminiModel: selectedModel as any });
  });
});

presetSelect?.addEventListener("change", async () => {
  const selectedPreset = presetSelect.value as DictationPreset;
  updatePresetPills(selectedPreset);
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

translateToggleBtn?.addEventListener("click", async () => {
  translateEnabled = !translateEnabled;
  updateTranslateBtnUI();
  if (translateEnabled) {
    playMechanicalClickSound();
  }
  await window.electronIPC?.saveConfig({ translateEnabled });
});

targetLanguageSelect?.addEventListener("change", async () => {
  const selectedLang = targetLanguageSelect.value;
  await window.electronIPC?.saveConfig({ targetLanguage: selectedLang });
});

clearHistoryBtn?.addEventListener("click", async () => {
  await window.electronIPC?.clearHistory();
  await renderHistory();
});

configBtn?.addEventListener("click", () => {
  if (settingsModal) {
    settingsModal.classList.remove("hidden");
    renderPersonNames();
    renderVocabTags();
  }
});

document.querySelectorAll(".modal-tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const targetTab = btn.getAttribute("data-tab");
    document.querySelectorAll(".modal-tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    document.querySelectorAll(".tab-pane").forEach((pane) => {
      if (pane.id === targetTab) {
        pane.classList.remove("hidden");
      } else {
        pane.classList.add("hidden");
      }
    });
  });
});

addPersonNameBtn?.addEventListener("click", () => {
  if (personNameInput) {
    addPersonName(personNameInput.value);
  }
});

personNameInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && personNameInput) {
    e.preventDefault();
    addPersonName(personNameInput.value);
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
  const k1 = geminiApiKey1Input?.value.trim() || "";
  const k2 = geminiApiKey2Input?.value.trim() || "";
  const k3 = geminiApiKey3Input?.value.trim() || "";
  const keyVal = [k1, k2, k3].filter(Boolean).join(",") || undefined;

  if (apiKeyFeedback) {
    apiKeyFeedback.textContent = "Testing API Key(s)...";
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
  const k1 = geminiApiKey1Input?.value.trim() || "";
  const k2 = geminiApiKey2Input?.value.trim() || "";
  const k3 = geminiApiKey3Input?.value.trim() || "";
  const combinedKeys = [k1, k2, k3].filter(Boolean).join(",");

  await window.electronIPC?.saveConfig({ geminiApiKey: combinedKeys });
  if (apiKeyFeedback) {
    const keyCount = [k1, k2, k3].filter(Boolean).length;
    apiKeyFeedback.textContent = keyCount > 0 ? `✓ Saved ${keyCount} Primary Gemini Key(s)!` : "Primary API Keys cleared.";
    apiKeyFeedback.style.color = keyCount > 0 ? "#10b981" : "#ef4444";
    apiKeyFeedback.style.display = "block";
    setTimeout(() => {
      apiKeyFeedback.style.display = "none";
    }, 2500);
  }
});

saveFallbackApiKeyBtn?.addEventListener("click", async () => {
  const fallbackKeyVal = geminiFallbackApiKeyInput?.value ? geminiFallbackApiKeyInput.value.trim() : "";
  await window.electronIPC?.saveConfig({ geminiFallbackApiKey: fallbackKeyVal });
  if (fallbackApiKeyFeedback) {
    fallbackApiKeyFeedback.textContent = fallbackKeyVal ? "✓ Paid Fallback API Key saved!" : "Fallback API Key cleared.";
    fallbackApiKeyFeedback.style.color = fallbackKeyVal ? "#10b981" : "#a1a1aa";
    fallbackApiKeyFeedback.style.display = "block";
    setTimeout(() => {
      if (fallbackApiKeyFeedback) fallbackApiKeyFeedback.style.display = "none";
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
      let mainKey = e.key.toLowerCase();
      if (e.code && e.code.startsWith("Key")) {
        mainKey = e.code.replace("Key", "").toLowerCase();
      } else if (e.code && e.code.startsWith("Digit")) {
        mainKey = e.code.replace("Digit", "");
      }

      const keyStr = [...modifiers, mainKey].join("+");
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

let isRecordingEditHotkey = false;

resetEditShortcutBtn?.addEventListener("click", async () => {
  const res = await window.electronIPC?.registerEditHotkey("ctrl+cmd+option+e");
  if (res?.success) {
    editKeycapDisplay.textContent = res.keyDisplay || "⌃⌥⌘E";
    hideEditHotkeyError();
  }
});

recordEditBtn?.addEventListener("click", () => {
  if (!isRecordingEditHotkey) {
    startEditHotkeyRecording();
  } else {
    stopEditHotkeyRecording();
  }
});

function startEditHotkeyRecording() {
  isRecordingEditHotkey = true;
  recordEditBtn.textContent = "Record";
  editKeycapDisplay.textContent = "Press shortcut...";
  hideEditHotkeyError();

  const handleKeyDown = async (e: KeyboardEvent) => {
    e.preventDefault();
    if (e.key === "Escape") {
      stopEditHotkeyRecording();
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
      let mainKey = e.key.toLowerCase();
      if (e.code && e.code.startsWith("Key")) {
        mainKey = e.code.replace("Key", "").toLowerCase();
      } else if (e.code && e.code.startsWith("Digit")) {
        mainKey = e.code.replace("Digit", "");
      }

      const keyStr = [...modifiers, mainKey].join("+");
      const res = await window.electronIPC?.registerEditHotkey(keyStr);
      if (res?.success) {
        editKeycapDisplay.textContent = res.keyDisplay || keyStr;
        hideEditHotkeyError();
      } else if (res?.error) {
        showEditHotkeyError(res.error);
      }
      stopEditHotkeyRecording();
      window.removeEventListener("keydown", handleKeyDown);
    }
  };

  window.addEventListener("keydown", handleKeyDown);
}

function stopEditHotkeyRecording() {
  isRecordingEditHotkey = false;
  recordEditBtn.textContent = "Record";
}

function showEditHotkeyError(msg: string) {
  if (editHotkeyFeedback) {
    editHotkeyFeedback.textContent = msg;
    editHotkeyFeedback.style.display = "block";
  }
}

function hideEditHotkeyError() {
  if (editHotkeyFeedback) {
    editHotkeyFeedback.style.display = "none";
  }
}

initUI();
