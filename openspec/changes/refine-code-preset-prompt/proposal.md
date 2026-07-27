# Proposal: Refine Code Dictation Preset Prompt (Anti-Hallucination & High Fidelity)

## Why
The current `code_comment` dictation preset uses a "Lead Systems Architect" persona that frequently over-improvises, invents unsaid technical requirements/state managers, and inflates concise user spoken dictation into bloated architectural paragraphs. Developers need a high-fidelity, systematic dictation prompt that translates spoken Burmese/English into clean, direct technical instructions without any hallucinated assumptions or unsaid logic.

## Scope
- Replace the "Lead Systems Architect" persona in `getPresetPromptInstructions("code_comment")` in `src/services/stt.ts` with a "Systematic Code Dictation Engine".
- Enforce strict anti-hallucination rules: no invented code blocks, no unsaid framework additions, no extra unsaid architectural steps.
- Maintain 100% fidelity to spoken user intent, formatting input into direct, clear, concise engineering imperatives.
- Update unit tests in `stt.test.ts` and `menu-bar-gui.test.ts` to assert the new systematic prompt contract.

## Capabilities
### Modified Capabilities
- `code-dictation-prompt`: Refine prompt directives for `code_comment` preset to prioritize 100% fidelity, zero improvisation, and concise imperative formatting.
