## 1. Domain Decoupling & Structure

- [ ] 1.1 Create `src/core/` domain modules for STT engine, State Machine, Config, and History.
- [ ] 1.2 Create `src/native/` domain modules for macOS Window & Paste accessibility integration.
- [ ] 1.3 Create `src/ui/` domain modules for Electron Main, Popover GUI, Capture Engine, and CLI.

## 2. Dependency & Package Normalization

- [ ] 2.1 Audit and clean `package.json` dependencies.
- [ ] 2.2 Update import paths across services and test suites.

## 3. Verification & Packaging

- [ ] 3.1 Run full test suite (`bun test`) to ensure 220/220 tests pass.
- [ ] 3.2 Build production bundle (`bun run build`) and launch daemon (`bun src/cli.ts start`).
- [ ] 3.3 Repackage DMG installer (`bun run dist:dmg`).
- [ ] 3.4 Archive OpenSpec change proposal (`openspec archive standalone-modular-refactor --yes`).
