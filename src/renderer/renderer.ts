import type { AppState, ChimeSoundChoice, StatePayload, GeminiModelChoice, DictionaryEntry, VocabularyCategory } from "../shared/types.js";
import { validateDictionaryEntries } from "../services/dictionary-engine.js";
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
const dictionaryPhraseInput = document.getElementById("dictionaryPhraseInput") as HTMLInputElement;
const dictionaryAliasesInput = document.getElementById("dictionaryAliasesInput") as HTMLInputElement;
const dictionaryCategorySelect = document.getElementById("dictionaryCategorySelect") as HTMLSelectElement;
const addDictionaryEntryBtn = document.getElementById("addDictionaryEntryBtn") as HTMLButtonElement;
const dictionaryValidation = document.getElementById("dictionaryValidation") as HTMLElement;
const dictionaryEntriesContainer = document.getElementById("dictionaryEntriesContainer") as HTMLElement;
const vocabTotalCountBadge = document.getElementById("vocabTotalCountBadge") as HTMLElement;
let dictionaryEntries: DictionaryEntry[] = [];
let editingDictionaryId: string | null = null;
let currentVocabFilter = "all";

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
const autoEndpointToggle = document.getElementById("autoEndpointToggle") as HTMLInputElement;
const transcriptionDelayInput = document.getElementById("transcriptionDelayInput") as HTMLInputElement;
const settingModelSelect = document.getElementById("settingModelSelect") as HTMLSelectElement;
const micDeviceSelect = document.getElementById("micDeviceSelect") as HTMLSelectElement;
const addAppRuleBtn = document.getElementById("addAppRuleBtn") as HTMLButtonElement | null;
const newAppNameInput = document.getElementById("newAppNameInput") as HTMLInputElement | null;
const newAppPresetSelect = document.getElementById("newAppPresetSelect") as HTMLSelectElement | null;



let currentAppMappings: Record<string, DictationPreset> = {};

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

if (typeof navigator !== "undefined" && navigator.mediaDevices && typeof navigator.mediaDevices.addEventListener === "function") {
  navigator.mediaDevices.addEventListener("devicechange", () => {
    populateAudioDevices(micDeviceSelect?.value);
  });
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
  const config = await window.piVoice?.getConfig();
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
    if (editKeycapDisplay && config.editKeyDisplay) {
      editKeycapDisplay.textContent = config.editKeyDisplay;
    }
    audioChimesEnabled = config.audioChimesEnabled ?? true;
    updateChimeBtnUI();
    translateEnabled = config.translateEnabled ?? false;
    updateTranslateBtnUI();
    if (targetLanguageSelect && config.targetLanguage) {
      targetLanguageSelect.value = config.targetLanguage;
    }

    if (config.customVocabulary) {
      currentCustomVocab = [...config.customVocabulary];
    }
    dictionaryEntries = Array.isArray(config.dictionaryEntries) ? config.dictionaryEntries.map((entry: DictionaryEntry) => ({ ...entry, spokenAliases: [...entry.spokenAliases] })) : [];
    if (config.presetVocabulary) {
      currentPresetVocabMap = config.presetVocabulary as Record<string, string[]>;
    }
    if (config.appPresetMappings) {
      currentAppMappings = { ...config.appPresetMappings };
    }
    if (geminiApiKey1Input) {
      geminiApiKey1Input.value = "";
      geminiApiKey1Input.placeholder = config?.hasGeminiKey
        ? "Primary Key 1 (Configured - write to replace)"
        : "Primary Key 1 (AIzaSy...)";
    }
    if (geminiApiKey2Input) geminiApiKey2Input.value = "";
    if (geminiApiKey3Input) geminiApiKey3Input.value = "";

    if (geminiFallbackApiKeyInput) {
      geminiFallbackApiKeyInput.value = "";
      geminiFallbackApiKeyInput.placeholder = config?.hasGeminiFallbackKey
        ? "Paid Gemini API Key (Configured - write to replace)"
        : "Paste Paid Gemini API Key (Emergency Failover Backup)";
    }
    if (chimeStartSelect && config.chimeSoundStart) {
      chimeStartSelect.value = config.chimeSoundStart;
    }
    if (chimeEndSelect && config.chimeSoundEnd) {
      chimeEndSelect.value = config.chimeSoundEnd;
    }
    if (symbolScannerToggle && config.symbolScannerEnabled !== undefined) {
      symbolScannerToggle.checked = config.symbolScannerEnabled;
    }
    if (autoEndpointToggle && config.autoEndpointEnabled !== undefined) {
      autoEndpointToggle.checked = config.autoEndpointEnabled;
    }
    if (transcriptionDelayInput && config.transcriptionDelaySec !== undefined) {
      transcriptionDelayInput.value = config.transcriptionDelaySec.toString();
    }
    if (settingModelSelect && config.geminiModel) {
      settingModelSelect.value = config.geminiModel;
    }
    await populateAudioDevices(config.audioDeviceId);
    renderAppRules();
    renderPersonNames();
    renderVocabTags();
    renderDictionaryEntries();
    await renderHistory();
  }

  if (micDeviceSelect) {
    micDeviceSelect.addEventListener("change", async () => {
      await window.piVoice?.saveConfig({ audioDeviceId: micDeviceSelect.value });
    });
  }

  if (addAppRuleBtn) {
    addAppRuleBtn.addEventListener("click", async () => {
      const name = newAppNameInput?.value.trim().toLowerCase();
      const preset = newAppPresetSelect?.value;
      if (name && preset) {
        currentAppMappings[name] = preset as DictationPreset;
        if (newAppNameInput) newAppNameInput.value = "";
        renderAppRules();
        await window.piVoice?.saveConfig({ appPresetMappings: currentAppMappings });
      }
    });
  }

  const snapshot = await window.piVoice?.getStateSnapshot();
  if (snapshot) {
    updateStatusBadge(snapshot.state, snapshot.message);
  }

  await renderHistory();
  renderVocabTags();
  renderDictionaryEntries();
}

function showDictionaryMessage(message = "", isError = true) {
  if (dictionaryValidation) {
    dictionaryValidation.style.color = isError ? "#fca5a5" : "#86efac";
    dictionaryValidation.textContent = message;
  }
}

function showDictionaryError(message = "") {
  showDictionaryMessage(message, true);
}

function renderDictionaryEntries(highlightId?: string) {
  if (!dictionaryEntriesContainer) return;
  dictionaryEntriesContainer.innerHTML = "";

  if (vocabTotalCountBadge) {
    vocabTotalCountBadge.textContent = `${dictionaryEntries.length} Entries`;
  }

  const filteredEntries = dictionaryEntries.filter((entry) => {
    if (currentVocabFilter === "general") return entry.category === "general";
    if (currentVocabFilter === "person_name") return entry.category === "person_name";
    if (currentVocabFilter === "technical") return entry.category === "technical";
    return true;
  });

  if (filteredEntries.length === 0) {
    dictionaryEntriesContainer.textContent = dictionaryEntries.length === 0
      ? "No trusted entries yet"
      : "No entries match current filter";
    return;
  }

  let highlightedElement: HTMLElement | null = null;

  for (const entry of filteredEntries) {
    const row = document.createElement("div");
    row.className = "vocab-tag";
    row.dataset.id = entry.id;
    row.style.opacity = entry.enabled ? "1" : "0.5";
    if (entry.id === highlightId) {
      highlightedElement = row;
      row.style.borderColor = "#22c55e";
      row.style.boxShadow = "0 0 8px rgba(34, 197, 94, 0.5)";
      setTimeout(() => {
        row.style.borderColor = "";
        row.style.boxShadow = "";
      }, 2500);
    }
    const label = document.createElement("span");
    let catBadge = "";
    if (entry.category === "person_name") catBadge = " [Person]";
    else if (entry.category === "technical") catBadge = " [Tech]";
    else if (entry.category === "general") catBadge = " [General]";

    label.textContent = `${entry.phrase} ← ${entry.spokenAliases.join(", ")}${catBadge}`;
    row.appendChild(label);
    const toggle = document.createElement("button");
    toggle.textContent = entry.enabled ? "Disable" : "Enable";
    toggle.title = toggle.textContent;
    toggle.addEventListener("click", () => updateDictionaryEntry({ ...entry, enabled: !entry.enabled }));
    row.appendChild(toggle);
    const edit = document.createElement("button");
    edit.textContent = "Edit";
    edit.addEventListener("click", () => {
      dictionaryPhraseInput.value = entry.phrase;
      dictionaryAliasesInput.value = entry.spokenAliases.join(", ");
      if (dictionaryCategorySelect) dictionaryCategorySelect.value = entry.category || "general";
      editingDictionaryId = entry.id;
      addDictionaryEntryBtn.textContent = "Save";
      showDictionaryMessage("");
    });
    row.appendChild(edit);
    const remove = document.createElement("button");
    remove.textContent = "Delete";
    remove.addEventListener("click", () => saveDictionaryEntries(dictionaryEntries.filter((item) => item.id !== entry.id)));
    row.appendChild(remove);
    dictionaryEntriesContainer.appendChild(row);
  }

  if (highlightedElement) {
    highlightedElement.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

async function saveDictionaryEntries(nextEntries: DictionaryEntry[], highlightId?: string) {
  const errors = validateDictionaryEntries(nextEntries);
  if (errors.length > 0) {
    showDictionaryError(errors.map((error) => `${error.alias}: ${error.message}`).join("; "));
    return false;
  }
  try {
    const config = await window.piVoice?.saveConfig({ dictionaryEntries: nextEntries });
    dictionaryEntries = (config?.dictionaryEntries || nextEntries) as DictionaryEntry[];
    renderDictionaryEntries(highlightId);
    return true;
  } catch (error) {
    showDictionaryError(error instanceof Error ? error.message : "Could not save dictionary entry");
    return false;
  }
}

async function updateDictionaryEntry(entry: DictionaryEntry) {
  await saveDictionaryEntries(dictionaryEntries.map((item) => item.id === entry.id ? entry : item), entry.id);
}

async function saveDictionaryEntry() {
  const phrase = dictionaryPhraseInput?.value.trim();
  const aliases = (dictionaryAliasesInput?.value || "").split(",").map((alias) => alias.trim()).filter(Boolean);
  const category = (dictionaryCategorySelect?.value as VocabularyCategory) || "general";

  if (!phrase) {
    showDictionaryError("Write as is required");
    return;
  }
  if (aliases.length === 0) aliases.push(phrase);

  const normPhrase = phrase.normalize("NFKC").toLocaleLowerCase();
  const existingEntry = !editingDictionaryId
    ? dictionaryEntries.find((entry) => entry.phrase.trim().normalize("NFKC").toLocaleLowerCase() === normPhrase)
    : null;

  const targetId = editingDictionaryId || existingEntry?.id || crypto.randomUUID();
  const mergedAliases = existingEntry
    ? Array.from(new Set([...existingEntry.spokenAliases, ...aliases]))
    : aliases;

  const nextEntry: DictionaryEntry = {
    id: targetId,
    phrase,
    spokenAliases: mergedAliases,
    enabled: true,
    category,
    ...(existingEntry?.legacyWhitespace ? { legacyWhitespace: true } : {}),
  };

  const isExistingInList = dictionaryEntries.some((entry) => entry.id === targetId);
  const nextEntries = isExistingInList
    ? dictionaryEntries.map((entry) => entry.id === targetId ? nextEntry : entry)
    : [...dictionaryEntries, nextEntry];

  const success = await saveDictionaryEntries(nextEntries, targetId);
  if (success) {
    showDictionaryMessage(`✓ Saved "${phrase} ← ${mergedAliases.join(", ")}"`, false);
    editingDictionaryId = null;
    if (dictionaryPhraseInput) dictionaryPhraseInput.value = "";
    if (dictionaryAliasesInput) dictionaryAliasesInput.value = "";
    if (dictionaryCategorySelect) dictionaryCategorySelect.value = "general";
    if (addDictionaryEntryBtn) addDictionaryEntryBtn.textContent = "+ Add Entry";
  }
}

function renderAppRules() {
  return;
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

export function setCustomVocabForTest(vocab: string[]) {
  currentCustomVocab = vocab;
}

export function getCustomVocabForTest() {
  return currentCustomVocab;
}

export function setPresetVocabMapForTest(map: Record<string, string[]>) {
  currentPresetVocabMap = map;
}

export function getPresetVocabMapForTest() {
  return currentPresetVocabMap;
}

export function renderPersonNames() {
  const container = personNamesContainer || document.getElementById("personNamesContainer");
  if (!container) return;
  container.innerHTML = "";

  const badge = personNamesCountBadge || document.getElementById("personNamesCountBadge");
  if (badge) {
    badge.textContent = `${currentCustomVocab.length} Names`;
  }

  if (currentCustomVocab.length === 0) {
    const emptySpan = document.createElement("span");
    emptySpan.className = "vocab-tag-empty";
    emptySpan.textContent = "No person names added yet";
    container.appendChild(emptySpan);
    return;
  }

  currentCustomVocab.forEach((term, index) => {
    const tag = document.createElement("span");
    tag.className = "vocab-tag";
    tag.style.borderColor = "rgba(59, 130, 246, 0.4)";
    tag.style.background = "rgba(59, 130, 246, 0.15)";
    tag.style.color = "#93c5fd";

    const textNode = document.createTextNode(`${term} `);
    tag.appendChild(textNode);

    const btn = document.createElement("button");
    btn.dataset.index = String(index);
    btn.title = "Remove name";
    btn.textContent = "×";
    btn.addEventListener("click", async () => {
      await removePersonName(index);
    });
    tag.appendChild(btn);

    container.appendChild(tag);
  });
}

export async function addPersonName(name: string) {
  const cleanName = name.trim();
  if (!cleanName) return;

  if (!currentCustomVocab.includes(cleanName)) {
    currentCustomVocab.push(cleanName);
    await window.piVoice?.saveConfig({ customVocabulary: currentCustomVocab });
    renderPersonNames();
  }
  if (personNameInput) personNameInput.value = "";
}

export async function removePersonName(index: number) {
  if (index >= 0 && index < currentCustomVocab.length) {
    currentCustomVocab.splice(index, 1);
    await window.piVoice?.saveConfig({ customVocabulary: currentCustomVocab });
    renderPersonNames();
  }
}

export function renderVocabTags() {
  const container = vocabTagsContainer || document.getElementById("vocabTagsContainer");
  const presetSelect = modalPresetSelect || (document.getElementById("modalPresetSelect") as HTMLSelectElement);
  if (!container || !presetSelect) return;
  const currentPreset = presetSelect.value;
  const terms = currentPresetVocabMap[currentPreset] || [];
  container.innerHTML = "";

  if (terms.length === 0) {
    const emptySpan = document.createElement("span");
    emptySpan.className = "vocab-tag-empty";
    emptySpan.textContent = `No vocabulary terms for ${currentPreset}`;
    container.appendChild(emptySpan);
    return;
  }

  terms.forEach((term, index) => {
    const tag = document.createElement("span");
    tag.className = "vocab-tag";

    const textNode = document.createTextNode(`${term} `);
    tag.appendChild(textNode);

    const btn = document.createElement("button");
    btn.dataset.index = String(index);
    btn.title = "Remove term";
    btn.textContent = "×";
    btn.addEventListener("click", async () => {
      await removeVocabTerm(currentPreset, index);
    });
    tag.appendChild(btn);

    container.appendChild(tag);
  });
}

export async function addVocabTerm(preset: string, term: string) {
  const cleanTerm = term.trim();
  if (!cleanTerm) return;

  const list = currentPresetVocabMap[preset] || [];
  if (!list.includes(cleanTerm)) {
    list.push(cleanTerm);
    currentPresetVocabMap[preset] = list;
    await window.piVoice?.saveConfig({ presetVocabulary: currentPresetVocabMap });
    renderVocabTags();
  }
  if (vocabInput) vocabInput.value = "";
}

export async function removeVocabTerm(preset: string, index: number) {
  const list = currentPresetVocabMap[preset] || [];
  if (index >= 0 && index < list.length) {
    list.splice(index, 1);
    currentPresetVocabMap[preset] = list;
    await window.piVoice?.saveConfig({ presetVocabulary: currentPresetVocabMap });
    renderVocabTags();
  }
}

export async function renderHistory() {
  const historyContainer = document.getElementById("historyContainer");
  if (!historyContainer) return;

  const history: HistoryEntry[] = (await window.piVoice?.getHistory()) || [];

  if (history.length === 0) {
    const emptyDiv = document.createElement("div");
    emptyDiv.className = "history-empty";
    emptyDiv.textContent = "No recent dictations";
    historyContainer.innerHTML = "";
    historyContainer.appendChild(emptyDiv);
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

    metaEl.textContent = `${timeStr} · ${item.activeApp || "App"}`;

    el.title = "Click to copy text to clipboard";
    el.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(item.text);
        const originalText = metaEl.textContent;
        metaEl.textContent = "";
        const copiedSpan = document.createElement("span");
        copiedSpan.style.color = "#34d399";
        copiedSpan.style.fontWeight = "600";
        copiedSpan.textContent = "✓ Copied to clipboard!";
        metaEl.appendChild(copiedSpan);
        setTimeout(() => {
          metaEl.textContent = originalText;
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

window.piVoice?.onStateChanged((payload: StatePayload) => {
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

window.piVoice?.onAudioLevelUpdate((payload: number | { level: number; spectrum?: number[] }) => {
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
  if (resetShortcutBtn) resetShortcutBtn.disabled = !enabled;
  if (recordEditBtn) recordEditBtn.disabled = !enabled;
  if (resetEditShortcutBtn) resetEditShortcutBtn.disabled = !enabled;
  configBtn.disabled = !enabled;
}

document.querySelectorAll(".preset-pill-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    playMechanicalClickSound();
    const selectedPreset = btn.getAttribute("data-preset") as DictationPreset;
    if (!selectedPreset) return;
    updatePresetPills(selectedPreset);
    if (presetSelect) presetSelect.value = selectedPreset;
    await window.piVoice?.saveConfig({ dictationPreset: selectedPreset });
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
    await window.piVoice?.saveConfig({ geminiModel: selectedModel as GeminiModelChoice });
  });
});

presetSelect?.addEventListener("change", async () => {
  const selectedPreset = presetSelect.value as DictationPreset;
  updatePresetPills(selectedPreset);
  await window.piVoice?.saveConfig({ dictationPreset: selectedPreset });
});

modeSelect?.addEventListener("change", async () => {
  const selectedMode = modeSelect.value as DictationMode;
  await window.piVoice?.saveConfig({ dictationMode: selectedMode });
});

gainSlider?.addEventListener("input", () => {
  const val = parseFloat(gainSlider.value);
  gainValue.textContent = `${val.toFixed(2)}×`;
  gainSlider.setAttribute("aria-valuenow", val.toFixed(2));
});

gainSlider?.addEventListener("change", async () => {
  const val = parseFloat(gainSlider.value);
  await window.piVoice?.saveConfig({ inputGain: val });
});

modelSelect?.addEventListener("change", async () => {
  const selectedModel = modelSelect.value as GeminiModelChoice;
  if (settingModelSelect) settingModelSelect.value = selectedModel;
  await window.piVoice?.saveConfig({ geminiModel: selectedModel });
});

settingModelSelect?.addEventListener("change", async () => {
  const selectedModel = settingModelSelect.value as GeminiModelChoice;
  if (modelSelect) modelSelect.value = selectedModel;
  await window.piVoice?.saveConfig({ geminiModel: selectedModel });
});

chimeBtn?.addEventListener("click", async () => {
  audioChimesEnabled = !audioChimesEnabled;
  updateChimeBtnUI();
  if (audioChimesEnabled) {
    playBassyEndChime();
  }
  await window.piVoice?.saveConfig({ audioChimesEnabled });
});

translateToggleBtn?.addEventListener("click", async () => {
  translateEnabled = !translateEnabled;
  updateTranslateBtnUI();
  if (translateEnabled) {
    playMechanicalClickSound();
  }
  const updatedConfig = await window.piVoice?.saveConfig({ translateEnabled });
  if (updatedConfig && updatedConfig.translateEnabled !== undefined) {
    translateEnabled = updatedConfig.translateEnabled;
    updateTranslateBtnUI();
  }
});

targetLanguageSelect?.addEventListener("change", async () => {
  const selectedLang = targetLanguageSelect.value;
  const updatedConfig = await window.piVoice?.saveConfig({ targetLanguage: selectedLang });
  if (updatedConfig && updatedConfig.targetLanguage && targetLanguageSelect) {
    targetLanguageSelect.value = updatedConfig.targetLanguage;
  }
});

clearHistoryBtn?.addEventListener("click", async () => {
  await window.piVoice?.clearHistory();
  await renderHistory();
});

configBtn?.addEventListener("click", () => {
  if (settingsModal) {
    settingsModal.classList.remove("hidden");
    renderPersonNames();
    renderVocabTags();
    renderDictionaryEntries();
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

addDictionaryEntryBtn?.addEventListener("click", () => {
  saveDictionaryEntry();
});

dictionaryPhraseInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    saveDictionaryEntry();
  }
});

dictionaryAliasesInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    saveDictionaryEntry();
  }
});

dictionaryPhraseInput?.addEventListener("input", () => showDictionaryError(""));
dictionaryAliasesInput?.addEventListener("input", () => showDictionaryError(""));

document.querySelectorAll(".vocab-filter-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".vocab-filter-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentVocabFilter = (btn as HTMLElement).dataset.filter || "all";
    renderDictionaryEntries();
  });
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
  const res = await (window.piVoice as any)?.testApiKey(keyVal);
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

  const updatedConfig = await window.piVoice?.saveConfig({ geminiApiKey: combinedKeys });
  if (geminiApiKey1Input) {
    geminiApiKey1Input.value = "";
    geminiApiKey1Input.placeholder = updatedConfig?.hasGeminiKey
      ? "Primary Key 1 (Configured - write to replace)"
      : "Primary Key 1 (AIzaSy...)";
  }
  if (geminiApiKey2Input) geminiApiKey2Input.value = "";
  if (geminiApiKey3Input) geminiApiKey3Input.value = "";

  if (apiKeyFeedback) {
    const keyCount = [k1, k2, k3].filter(Boolean).length;
    apiKeyFeedback.textContent = updatedConfig?.hasGeminiKey ? `✓ Saved ${keyCount || 1} Primary Gemini Key(s)!` : "Primary API Keys cleared.";
    apiKeyFeedback.style.color = updatedConfig?.hasGeminiKey ? "#10b981" : "#ef4444";
    apiKeyFeedback.style.display = "block";
    setTimeout(() => {
      apiKeyFeedback.style.display = "none";
    }, 2500);
  }
});

saveFallbackApiKeyBtn?.addEventListener("click", async () => {
  const fallbackKeyVal = geminiFallbackApiKeyInput?.value ? geminiFallbackApiKeyInput.value.trim() : "";
  const updatedConfig = await window.piVoice?.saveConfig({ geminiFallbackApiKey: fallbackKeyVal });
  if (geminiFallbackApiKeyInput) {
    geminiFallbackApiKeyInput.value = "";
    geminiFallbackApiKeyInput.placeholder = updatedConfig?.hasGeminiFallbackKey
      ? "Paid Gemini API Key (Configured - write to replace)"
      : "Paste Paid Gemini API Key (Emergency Failover Backup)";
  }
  if (fallbackApiKeyFeedback) {
    fallbackApiKeyFeedback.textContent = updatedConfig?.hasGeminiFallbackKey ? "✓ Paid Fallback API Key saved!" : "Fallback API Key cleared.";
    fallbackApiKeyFeedback.style.color = updatedConfig?.hasGeminiFallbackKey ? "#10b981" : "#a1a1aa";
    fallbackApiKeyFeedback.style.display = "block";
    setTimeout(() => {
      if (fallbackApiKeyFeedback) fallbackApiKeyFeedback.style.display = "none";
    }, 2500);
  }
});

chimeStartSelect?.addEventListener("change", async () => {
  await window.piVoice?.saveConfig({ chimeSoundStart: chimeStartSelect.value as ChimeSoundChoice });
});

chimeEndSelect?.addEventListener("change", async () => {
  await window.piVoice?.saveConfig({ chimeSoundEnd: chimeEndSelect.value as ChimeSoundChoice });
});

symbolScannerToggle?.addEventListener("change", async () => {
  await window.piVoice?.saveConfig({ symbolScannerEnabled: symbolScannerToggle.checked });
});

autoEndpointToggle?.addEventListener("change", async () => {
  await window.piVoice?.saveConfig({ autoEndpointEnabled: autoEndpointToggle.checked });
});

transcriptionDelayInput?.addEventListener("change", async () => {
  const val = parseFloat(transcriptionDelayInput.value);
  if (!isNaN(val)) {
    const clamped = Math.max(0.0, Math.min(10.0, val));
    transcriptionDelayInput.value = clamped.toString();
    await window.piVoice?.saveConfig({ transcriptionDelaySec: clamped });
  }
});

previewStartChimeBtn?.addEventListener("click", async () => {
  await window.piVoice?.previewChime(chimeStartSelect.value);
});

previewEndChimeBtn?.addEventListener("click", async () => {
  await window.piVoice?.previewChime(chimeEndSelect.value);
});

resetShortcutBtn?.addEventListener("click", async () => {
  const res = await window.piVoice?.registerHotkey("ctrl+cmd+option+v");
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
      const res = await window.piVoice?.registerHotkey(keyStr);
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
  const res = await window.piVoice?.registerEditHotkey("ctrl+cmd+option+e");
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
      const res = await window.piVoice?.registerEditHotkey(keyStr);
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

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !isRecordingHotkey && !isRecordingEditHotkey) {
    window.piVoice?.cancelDictation?.();
  }
});

initUI();
