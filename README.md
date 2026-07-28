# vo — Voice Interface & Dictation System

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/Ospeto/vo)
[![License: CC BY-NC 4.0](https://img.shields.io/badge/License-CC_BY--NC_4.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc/4.0/)
[![Platform](https://img.shields.io/badge/platform-macOS_Apple_Silicon-black.svg)](https://github.com/Ospeto/vo)
[![Tests](https://img.shields.io/badge/tests-266%2F266_passing-brightgreen.svg)](https://github.com/Ospeto/vo)

**`vo`** is an ultra-fast, high-precision voice dictation and speech-to-text translation interface built for macOS Apple Silicon. Powered by Google Gemini Multimodal APIs, `vo` seamlessly transcribes spoken Burmese audio into clean, technical English software specifications or written Burmese prose directly into focused text fields across VS Code, Cursor, Myanso, Terminals, Obsidian, and Slack. Paste is target-aware: if the focused window changes or native paste is unavailable, the transcript is retained without injecting text.

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            vo SYSTEM ARCHITECTURE                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ GLOBAL HOTKEY ]  ───────▶ [ AUDIO RECORDER ]                             │
│  (Ctrl+Cmd+Option+V)         (Native WebAudio Capture)                      │
│                                      │                                      │
│                                      ▼                                      │
│                        [ DYNAMIC SYMBOL SCANNER ]                           │
│                        (Sub-15ms Workspace AST/Regex)                       │
│                                      │                                      │
│                                      ▼                                      │
│                        [ GEMINI MULTIMODAL STT ]                            │
│                        (SystemInstruction Prompt Enforcer)                  │
│                                      │                                      │
│                                      ▼                                      │
│            [ NON-EDITING TRANSLATION SAFETY FALLBACK ]                      │
│              (Only when auto-translation is enabled)                       │
│                                      │                                      │
│                                      ▼                                      │
│                       [ NATIVE PASTE INJECTION ]                            │
│                      (Target-Aware Native Paste)                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## ✨ Key Features

### 1. ⚡ Multimodal Speech-to-Text & Translation Engine
- Supports **Gemini 3.6 Flash**, **Gemini 3.5 Flash Lite**, **Gemini 3.1 Flash Lite**, and **Gemini 2.5 Pro**.
- Automatically translates spoken Burmese instructions into pure Senior Software Engineer English specifications.
- Applies enabled trusted-dictionary aliases locally after transcription with exact, deterministic matching across supported speech providers.

### 2. 🧠 Dynamic Workspace Symbol Scanner (Zero-Hallucination Engine)
- Automatically scans exported functions, classes, interfaces, and file names from your active project workspace.
- Injects workspace symbols into Gemini system instructions, guaranteeing 100% verbatim accuracy for custom codebase identifiers (e.g., `resolveConfigPath`, `settleMatchingLifecycleError`).

### 3. 🎯 Smart App Preset Routing
- **`auto`**: Automatically detects your active application and routes dictation mode:
  - Code Editors (`VS Code`, `Cursor`, `Myanso`, `Terminal`) ➔ `code_comment` (English Tech Spec)
  - Notes & Vaults (`Obsidian`) ➔ `burmese_written` (Standard Burmese Prose)
  - Mail & Chat (`Slack`, `Mail`) ➔ `email_polish` (Polished English)
- **`careful`**: Deep proofreading and semantic reasoning while preserving the speaker's intent.
- **`code_comment`**: Software engineering specification mode.
- **`burmese_written`**: Formal Burmese written prose.
- **`email_polish`**: Refined professional communication.
- **`translate`**: Careful Burmese-to-English translation.
- **`fast`**: Raw verbatim Burmese transcription.

### 4. 🔊 Notification Audio Chimes Settings
- 6 curated macOS system sound options: **Glass (Classic)**, **Ping (Metallic)**, **Pop (Bubble)**, **Tink (High Chime)**, **Submarine (Sonar)**, and **Hero (Triumph)**.
- Independent selection and instant preview buttons for **Step 1 (Start Recording)** and **Step 2 (Completion Alert)** tones.

### 5. 🖱️ Menu Bar Right-Click Context Menu
- Right-click the menubar tray icon for quick access to:
  - App Status & Dictation State
  - **Start Dictation / Stop Recording** toggle action
  - **Dynamic Symbol Scanner** ON/OFF toggle switch
  - **Audio Chimes** ON/OFF toggle switch
  - **Open Settings...** modal trigger
  - **Quit vo** (Cmd+Q) exit action

### 6. ↩️ Voice Undo Command
- Speak *"undo"*, *"ဖျက်လိုက်"*, or *"ပြန်ဖြတ်"* to automatically issue `Cmd+Z` and revert the last pasted dictation.

### 7. 📊 Monthly Cost & History Tracker
- In-memory & persistent history tracking up to **200 entries**.
- Live monthly API cost calculation badge (`Month: $0.00xxx`).

---

## ⚙️ Configuration & Shortcuts

| Setting | Default Value | Description |
| :--- | :--- | :--- |
| **Dictation Hotkey** | `Ctrl + Cmd + Option + V` | Global shortcut to start/stop dictation |
| **Cancel Dictation** | `Escape` or the dictation hotkey | Cancels active recording or transcription and returns vo to idle without pasting the result |
| **Edit Hotkey** | `Ctrl + Cmd + Option + E` | Global shortcut to transform selected text; preserves clipboard formats while capturing and restoring the selection |
| **Dictation Preset** | `careful` | Default proofreading and semantic reasoning preset |
| **Default Model** | `gemini-3.1-flash-lite` | Ultra-fast multimodal STT model |
| **Symbol Scanner** | `true` (ON) | Workspace symbol auto-extraction toggle |
| **Audio Chimes** | `true` (Enabled) | Start & completion sound chimes |

Configuration settings are stored atomically at `~/.config/pi-voice/config.json`.

---

## 🛠️ Build & Installation

### Prerequisites
- macOS (Apple Silicon M1/M2/M3/M4 recommended)
- [Bun](https://bun.sh) runtime installed

### Building from Source

```bash
# Clone repository
git clone https://github.com/Ospeto/vo.git
cd vo

# Install dependencies
bun install

# Run unit test suite
bun test

# Build production bundle
bun run build

# Package macOS Desktop App (.app & .dmg)
bun run dist:dmg
```

Built application output will be placed in `dist/mac-arm64/vo.app`.

---

## 📄 License & Terms

Copyright (c) 2026 Ospeto / vo Contributors.

This software is licensed under the **Creative Commons Attribution-NonCommercial 4.0 International Public License (CC BY-NC 4.0)**.

- **Permitted**: Free personal, educational, research, and non-commercial use, modification, and redistribution with attribution.
- **Prohibited**: Commercial use, commercial redistribution, SaaS monetization, or commercial product bundling without prior explicit written permission.

See [LICENSE](file:///Users/macbookair/pi_voice_gemini/pi-voice/LICENSE) for full legal text.
