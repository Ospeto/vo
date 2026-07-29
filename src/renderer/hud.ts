import type { AppState, AudioLevelPayload, StatePayload } from "../shared/types.js";

const getElement = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`HUD element not found: ${id}`);
  return element as T;
};

const hudCapsule = getElement<HTMLElement>("hudCapsule");
const hudIcon = getElement<HTMLElement>("hudIcon");
const hudTitle = getElement<HTMLElement>("hudTitle");
const hudDetail = getElement<HTMLElement>("hudDetail");
const hudPaidBadge = getElement<HTMLElement>("hudPaidBadge");
const hudCancelBtn = getElement<HTMLButtonElement>("hudCancelBtn");

const stateIcons: Record<AppState | "selection", string> = {
  idle: `<svg viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  starting: `<svg viewBox="0 0 24 24" fill="none" stroke="#06B6D4" stroke-width="3"><circle cx="12" cy="12" r="8" stroke-dasharray="12 12" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1.5s" repeatCount="indefinite"/></circle></svg>`,
  recording: `<svg viewBox="0 0 24 24" fill="#EF4444"><circle cx="12" cy="12" r="7"/></svg>`,
  stopping: `<svg viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="3"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>`,
  transcribing: `<svg viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  thinking: `<svg viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a8 8 0 0 0-8 8c0 3 2 5.5 4 7v2a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2c2-1.5 4-4 4-7a8 8 0 0 0-8-8z"/></svg>`,
  speaking: `<svg viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`,
  error: `<svg viewBox="0 0 24 24" fill="none" stroke="#F97316" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  selection: `<svg viewBox="0 0 24 24" fill="none" stroke="#C084FC" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
};

const defaultTitles: Partial<Record<AppState, string>> = {
  idle: "DONE",
  starting: "STARTING",
  recording: "RECORDING",
  stopping: "STOPPING",
  transcribing: "TRANSCRIBING",
  thinking: "THINKING",
  speaking: "SPEAKING",
  error: "ERROR",
};

const defaultDetails: Partial<Record<AppState, string>> = {
  starting: "Connecting...",
  recording: "Listening...",
  stopping: "Finalizing...",
  transcribing: "Preparing text...",
  thinking: "Processing...",
  speaking: "Synthesizing...",
  error: "An error occurred",
};

hudCancelBtn.addEventListener("mousedown", (event) => {
  event.preventDefault();
});

hudCancelBtn.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  window.piVoice.cancelDictation();
});

function updateHud(payload: StatePayload): void {
  const state = payload.state ?? "idle";
  const hasSelection = Boolean(payload.hasSelection);
  const msg = payload.message ?? "";

  hudCapsule.className = `hud-capsule ${state}${hasSelection ? " has-selection" : ""}`;
  hudCapsule.classList.toggle("expanded", state !== "idle" || hasSelection || Boolean(msg));

  hudIcon.innerHTML = hasSelection && state !== "error" ? stateIcons.selection : stateIcons[state];

  const isActiveSelectionState = hasSelection && ["recording", "starting", "stopping", "transcribing"].includes(state);
  if (state === "error") {
    hudTitle.textContent = msg || defaultTitles.error || "ERROR";
    hudDetail.textContent = msg || defaultDetails.error || "";
  } else if (isActiveSelectionState) {
    hudTitle.textContent = msg || "EDITING";
    hudDetail.textContent = msg || "Transform selection";
  } else if (hasSelection && state === "idle") {
    hudTitle.textContent = "SELECTION";
    hudDetail.textContent = msg || "Edit selected text";
  } else {
    hudTitle.textContent = msg || defaultTitles[state] || state.toUpperCase();
    hudDetail.textContent = msg || defaultDetails[state] || "";
  }

  hudCancelBtn.setAttribute("aria-label", state === "error" ? "Dismiss error" : "Cancel dictation");
  hudCancelBtn.setAttribute("title", state === "error" ? "Dismiss" : "Cancel (Esc)");
  hudPaidBadge.style.display = payload.usedPaidKey === true && (state === "transcribing" || state === "idle") ? "inline-flex" : "none";
}

const audioHandler = (payload: number | AudioLevelPayload): void => {
  if (!hudCapsule.classList.contains("recording")) return;
  const level = typeof payload === "object" ? payload.level : payload;
  const clamped = Math.max(0.1, Math.min(1, (level || 0) * 2.5));
  const bars = document.querySelectorAll<HTMLElement>(".hud-bar");
  bars.forEach((bar, index) => {
    bar.style.height = `${Math.round(4 + clamped * (10 + (index % 3) * 3))}px`;
  });
};

window.piVoice.onStateChanged(updateHud);
window.piVoice.onAudioLevelUpdate(audioHandler);
