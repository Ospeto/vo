## 1. Dual-Layer Anti-Hesitation Implementation

- [ ] 1.1 Add `SPOKEN HESITATION PURGING` directive to `GLOBAL_BILINGUAL_DIRECTIVE` in `src/services/stt.ts`
- [ ] 1.2 Add morphological regex sanitizer targeting standalone `အာ`, `ဟာ`, `အင်`, `အင်း`, `အာ့` phonemes in `src/services/stt.ts`
- [ ] 1.3 Add comprehensive unit tests verifying hesitation purging and valid Burmese word preservation in `src/__tests__/services/stt.test.ts`
- [ ] 1.4 Run test suite (`bun test`) to ensure all tests pass

## 2. Re-build & Distribution

- [ ] 2.1 Build production bundle (`bun run build`)
- [ ] 2.2 Re-package macOS Desktop App (`bun run dist:dmg`)
- [ ] 2.3 Deploy updated `/Applications/vo.app` and commit to Git `v1.0.0`
