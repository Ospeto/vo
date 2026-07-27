# Proposal: Dual-Layer Precision Anti-Hesitation Engine

## Why
Occasional Burmese vocalizations (`အာ`, `ဟာ`, `အင်`, `အင်း`, `အာ့`) and stutters leak into transcribed dictation outputs. Implementing a Dual-Layer Anti-Hesitation Engine (Upstream Prompt Directive + Downstream Morphological Regex Sanitizer) guarantees clean dictations without degrading valid Burmese words (`အကြောင်း`, `အဆင်ပြေ`) or technical code identifiers.

## Scope
- Update `GLOBAL_BILINGUAL_DIRECTIVE` in `src/services/stt.ts` with explicit anti-hesitation purging instructions.
- Enhance `sanitizeTranscribedText` in `src/services/stt.ts` with morphological regexes targeting standalone Burmese vocalization phonemes (`အာ`, `ဟာ`, `အင်`, `အင်း`, `အာ့`) and attached punctuation.
- Add comprehensive unit tests in `src/__tests__/services/stt.test.ts` to assert hesitation purging while verifying zero regression on valid Burmese words.

## Capabilities
### Modified Capabilities
- `dual-layer-anti-hesitation`: Purge all spoken hesitations and vocal fillers upstream via Gemini system prompt and downstream via regex token sanitizer.
