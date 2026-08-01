# Burmese Coding Evaluation Boundary

## Overview

This document specifies the deterministic evaluation boundary for the VO mixed Burmese/English coding transcription task, from the PR 1 baseline through the Round 6 local metrics fixture.

PR 1 establishes a **deterministic, text-only baseline** for technical dictation characterization across three cohorts:
1. `english_only`: Pure English technical instructions and identifiers.
2. `burmese_only`: Pure Burmese instructions purged during code comment translation.
3. `mixed`: Mixed Burmese prose with English code identifiers, CLI commands, file paths, URLs, and package names.

*Note: PR 1 establishes the deterministic text characterization contract and makes no audio accuracy/latency claims.*

---

## Unit Testing Boundary (PR 1 Scope)

Unit tests in `src/__tests__/services/burmese-coding-baseline.test.ts` are strictly:
- **Provider-free**: No Gemini API, OpenAI API, or external network calls are executed during test runs.
- **Deterministic**: Tests evaluate pure functions (`resolveEffectivePreset`, `getPresetPromptInstructions`, `sanitizeTranscribedText`) against fixed text fixtures.
- **Secret-free**: Zero API keys or local credentials are required to run `bun test`.

## Local Accuracy Metrics (Round 6)

`src/__tests__/fixtures/accuracy-round6-eval.json` extends the deterministic,
provider-free boundary with synthetic post-processing cases. Run its repeatable
report from the repository root:

```bash
bun scripts/run-accuracy-eval.ts
```

Pass `--fixture <path>` to evaluate another suite with the same schema. The
report includes exact pass/fail results, word error rate (WER), accuracy,
word-level substitutions/insertions/deletions, duplicate-fragment counts, and
per-category summaries. These metrics characterize deterministic text
post-processing, endpointing simulations, and microphone-diagnostic fixtures;
they do not measure provider STT, real audio, or latency accuracy.

---

## Future Offline Audio Evaluation Boundary (Post-PR 1 Scope)

Future evaluation stages will execute an offline evaluation harness over standard audio samples. The boundary between PR 1 unit tests and future offline runners is defined as follows:

```
+-------------------------------------------------------------------------+
|                              PR 1 Scope                                 |
|  - Deterministic text fixtures in src/__tests__/fixtures/               |
|  - Unit tests in src/__tests__/services/burmese-coding-baseline.test.ts|
|  - Preset resolution, prompt instruction generation, text sanitization   |
+-------------------------------------------------------------------------+
                                     |
                                     v
+-------------------------------------------------------------------------+
|                       Future Offline Runner Scope                       |
|  - Pre-recorded WAV audio test corpus (same-audio benchmarking)         |
|  - Provider comparison (Gemini Flash Lite vs Whisper / alternative STTs) |
|  - Accuracy metrics: Word Error Rate (WER), protected token recall      |
|  - Offline batch runner executed outside CI unit test suite             |
+-------------------------------------------------------------------------+
```

### Why Live Audio & Provider Calls Are Excluded from Unit Tests

1. **Test Speed & Reliability**: Flaky network connections or provider latency should never cause CI unit test failures.
2. **Reproducibility**: Text fixtures guarantee identical input/output assertions across environments.
3. **Privacy & Security**: Unit testing requires zero telemetry, secrets, or remote API dependencies.

---

## Step-by-Step Procedural Specification for Future Same-Audio Evaluation

When executing same-audio evaluation post-PR 1, the offline evaluation harness must adhere strictly to the following procedural steps:

1. **Explicit Local Audio Inputs**:
   - Must accept explicit local audio files (e.g. WAV/FLAC) supplied from outside git repository history.
   - Raw audio evaluation files must never be committed to git.

2. **Identical Audio Byte Processing**:
   - Must run identical audio bytes through both the baseline (single-pass STT transcription/translation) and future candidates (e.g. two-step transcription + refinement passes).

3. **Controlled Experimental Context**:
   - Must hold model, app/preset context, configuration, and timeout budget constant across baseline and candidate runs.

4. **Comprehensive Data Capture**:
   - Must capture raw provider STT output, final sanitized output, errors, elapsed execution time/latency, and provider/fallback execution metadata for every sample.

5. **Ephemeral Reporting & Metrics**:
   - Must produce an ephemeral local report containing:
     - **WER & CER**: Word Error Rate and Character Error Rate (noting that WER/CER calculation requires an explicit ground-truth source reference transcript for the audio sample).
     - **Identifier Preservation Rates**: Exact recall and preservation percentage for protected technical identifiers, CLI commands, file paths, URLs, and package names.
     - **Translation Rubric Scores**: Standardized qualitative and quantitative scoring for Burmese-to-English translation fidelity.
     - **Operational Metrics**: Latency (p50, p95, p99), error frequencies, and provider fallback rates.

6. **Safety & Isolation Guarantees**:
   - Must never paste output into active applications or focused windows.
   - Must never write evaluation results to live user history or cost ledgers.
   - Must never persist raw audio files or reference transcripts by default after evaluation finishes.
   - Must never make live provider API calls during `bun test`.

---

## Fixture Schema & Protected Tokens

Fixtures are stored in `src/__tests__/fixtures/mixed-language-coding-eval.json`. Each entry defines:
- `id`: Unique fixture identifier.
- `cohort`: `english_only` | `burmese_only` | `mixed`.
- `text`: Input transcribed text.
- `protectedTokens`: Identifiers, commands, paths, URLs, or package names that must be preserved verbatim.
- `casingCues`: Specific casing conventions (`camelCase`, `snake_case`, `UPPERCASE`).
- `expectedSanitized`: Expected output under `translationOff` and `translationOn` modes.
- `description`: Test context.
