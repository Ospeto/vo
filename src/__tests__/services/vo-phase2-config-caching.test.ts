import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
	mkdtempSync,
	rmSync,
	writeFileSync,
	mkdirSync,
	existsSync,
	statSync,
} from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import {
	loadConfig,
	updateConfig,
	clearConfigCache,
	invalidateConfigCache,
	defaultConfig,
	getConfigAccessStats,
	resetConfigAccessStats,
} from "../../services/config.js";
import { transcribeDetailed } from "../../services/stt.js";
import { executeTwoStepTranslation } from "../../services/two-step-translation.js";
import {
	setGeminiClientForTests,
	getGeminiFallbackClient,
	_resetGeminiClient,
} from "../../services/gemini-client.js";
import {
	setVocabularyPathForTests,
} from "../../services/vocabulary-service.js";

describe("VO Phase 2: In-Memory Config Caching & Snapshot Threading Suite", () => {
	let testRoot: string;
	let userHome: string;
	let xdgConfig: string;
	let origHome: string | undefined;
	let origXdg: string | undefined;
	let testVocabPath: string;

	beforeEach(() => {
		testRoot = mkdtempSync(join(tmpdir(), "vo-phase2-test-"));
		userHome = join(testRoot, "home");
		xdgConfig = join(userHome, ".config");
		mkdirSync(xdgConfig, { recursive: true });

		testVocabPath = join(testRoot, "vocabulary.json");
		setVocabularyPathForTests(testVocabPath);

		origHome = process.env.HOME;
		origXdg = process.env.XDG_CONFIG_HOME;

		process.env.HOME = userHome;
		process.env.XDG_CONFIG_HOME = xdgConfig;

		clearConfigCache();
		resetConfigAccessStats();
		_resetGeminiClient();
	});

	afterEach(() => {
		setVocabularyPathForTests(null);
		clearConfigCache();
		resetConfigAccessStats();
		_resetGeminiClient();

		if (origHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = origHome;
		}
		if (origXdg === undefined) {
			delete process.env.XDG_CONFIG_HOME;
		} else {
			process.env.XDG_CONFIG_HOME = origXdg;
		}

		if (existsSync(testRoot)) {
			try {
				rmSync(testRoot, { recursive: true, force: true });
			} catch {
				// ignore
			}
		}
	});

	// =========================================================================
	// 1. Config Mutation & Immediate Visibility Suite
	// =========================================================================
	describe("1. Config Mutation & Immediate Visibility", () => {
		test("updateConfig immediately invalidates cache and updates subsequent loadConfig values", () => {
			const initial = loadConfig(testRoot);
			expect(initial.geminiModel).toBe("gemini-3.1-flash-lite");

			// Mutate via updateConfig
			const updated = updateConfig(testRoot, {
				geminiModel: "gemini-2.5-flash",
				dictationPreset: "code_comment",
			});
			expect(updated.geminiModel).toBe("gemini-2.5-flash");
			expect(updated.dictationPreset).toBe("code_comment");

			// Immediate visibility on next loadConfig without stale reads
			const reloaded = loadConfig(testRoot);
			expect(reloaded.geminiModel).toBe("gemini-2.5-flash");
			expect(reloaded.dictationPreset).toBe("code_comment");
		});

		test("tests do not touch or mutate the real user vocabulary file", () => {
			const realVocabPath = join(homedir(), ".config", "pi-voice", "vocabulary.json");
			const realExistedBefore = existsSync(realVocabPath);
			const realMtimeBefore = realExistedBefore ? statSync(realVocabPath).mtimeMs : 0;

			// Perform updateConfig with custom vocabulary
			updateConfig(testRoot, {
				customVocabulary: ["TestTermOne", "TestTermTwo"],
			});

			// Verify test wrote strictly to testVocabPath
			expect(existsSync(testVocabPath)).toBe(true);

			// Verify real user vocabulary file was NOT touched
			const realExistedAfter = existsSync(realVocabPath);
			expect(realExistedAfter).toBe(realExistedBefore);
			if (realExistedBefore) {
				expect(statSync(realVocabPath).mtimeMs).toBe(realMtimeBefore);
			}
		});

		test("external file write to config.json is immediately detected via file fingerprint and invalidates cache", async () => {
			const configDir = join(xdgConfig, "pi-voice");
			mkdirSync(configDir, { recursive: true });
			const configPath = join(configDir, "config.json");

			writeFileSync(
				configPath,
				JSON.stringify({
					provider: "gemini",
					geminiModel: "gemini-3.1-flash-lite",
					targetLanguage: "English",
				}),
			);

			const loaded1 = loadConfig(testRoot);
			expect(loaded1.targetLanguage).toBe("English");

			// Simulate external CLI or editor direct write to disk
			await Bun.sleep(10);
			writeFileSync(
				configPath,
				JSON.stringify({
					provider: "gemini",
					geminiModel: "gemini-3.1-flash-lite",
					targetLanguage: "Burmese",
				}),
			);

			// Fingerprint invalidation detects modification on disk immediately
			const loaded2 = loadConfig(testRoot);
			expect(loaded2.targetLanguage).toBe("Burmese");
		});

		test("direct external edits to vocabulary.json invalidate config cache and reflect updated vocabulary", async () => {
			const configDir = join(xdgConfig, "pi-voice");
			mkdirSync(configDir, { recursive: true });
			writeFileSync(join(configDir, "config.json"), JSON.stringify({ provider: "gemini" }));

			writeFileSync(
				testVocabPath,
				JSON.stringify({
					version: 2,
					customVocabulary: ["InitialTerm"],
					presetVocabulary: {},
					entries: [
						{
							id: "term-1",
							phrase: "InitialTerm",
							spokenAliases: ["InitialTerm"],
							enabled: true,
						},
					],
				}),
			);

			const loaded1 = loadConfig(testRoot);
			expect(loaded1.customVocabulary).toContain("InitialTerm");
			expect(loaded1.customVocabulary).not.toContain("ExternalTerm");

			// Simulate external edit to vocabulary.json
			await Bun.sleep(10);
			writeFileSync(
				testVocabPath,
				JSON.stringify({
					version: 2,
					customVocabulary: ["InitialTerm", "ExternalTerm"],
					presetVocabulary: {},
					entries: [
						{
							id: "term-1",
							phrase: "InitialTerm",
							spokenAliases: ["InitialTerm"],
							enabled: true,
						},
						{
							id: "term-2",
							phrase: "ExternalTerm",
							spokenAliases: ["ExternalTerm"],
							enabled: true,
						},
					],
				}),
			);

			// Cache fingerprint check on vocabulary.json triggers optimistic point-in-time invalidation
			const loaded2 = loadConfig(testRoot);
			expect(loaded2.customVocabulary).toContain("ExternalTerm");
		});

		test("workspace-specific configuration and isolation across distinct workspace paths", () => {
			const workspaceA = join(testRoot, "workspace-a");
			const workspaceB = join(testRoot, "workspace-b");
			mkdirSync(join(workspaceA, ".pi"), { recursive: true });
			mkdirSync(join(workspaceB, ".pi"), { recursive: true });

			writeFileSync(
				join(workspaceA, ".pi", "pi-voice.json"),
				JSON.stringify({ dictationPreset: "fast", inputGain: 1.1 }),
			);
			writeFileSync(
				join(workspaceB, ".pi", "pi-voice.json"),
				JSON.stringify({ dictationPreset: "code_comment", inputGain: 1.8 }),
			);

			const configA = loadConfig(workspaceA);
			const configB = loadConfig(workspaceB);

			expect(configA.dictationPreset).toBe("fast");
			expect(configA.inputGain).toBe(1.1);

			expect(configB.dictationPreset).toBe("code_comment");
			expect(configB.inputGain).toBe(1.8);

			// Update workspace A only
			updateConfig(workspaceA, { inputGain: 1.4 });

			expect(loadConfig(workspaceA).inputGain).toBe(1.4);
			expect(loadConfig(workspaceB).inputGain).toBe(1.8);
		});

		test("clearConfigCache and invalidateConfigCache force clean re-fetch on demand", () => {
			const c1 = loadConfig(testRoot);
			expect(c1).toBeDefined();

			clearConfigCache();
			const c2 = loadConfig(testRoot);
			expect(c2).toEqual(c1);

			invalidateConfigCache();
			const c3 = loadConfig(testRoot);
			expect(c3).toEqual(c1);
		});
	});

	// =========================================================================
	// 2. Snapshot-Safe Gemini Client Caching Suite
	// =========================================================================
	describe("2. Snapshot-Safe Gemini Client Caching", () => {
		test("getGeminiFallbackClient returns cached client when key matches and recreates on rotation", () => {
			_resetGeminiClient();

			const snapshotA = defaultConfig();
			snapshotA.geminiFallbackApiKey = "key-alpha-123";

			const client1 = getGeminiFallbackClient(snapshotA);
			expect(client1).not.toBeNull();

			// Calling again with same key returns the exact cached client instance
			const client2 = getGeminiFallbackClient(snapshotA);
			expect(client2).toBe(client1);

			// Rotating the key in snapshot triggers client recreation
			const snapshotB = defaultConfig();
			snapshotB.geminiFallbackApiKey = "key-beta-456";

			const client3 = getGeminiFallbackClient(snapshotB);
			expect(client3).not.toBeNull();
			expect(client3).not.toBe(client1);

			// Clearing the key sets fallbackClient to null
			const snapshotC = defaultConfig();
			snapshotC.geminiFallbackApiKey = "";
			const client4 = getGeminiFallbackClient(snapshotC);
			expect(client4).toBeNull();
		});
	});

	// =========================================================================
	// 3. Transcription Pipeline Zero / Single loadConfig() Invocation Suite
	// =========================================================================
	describe("3. Transcription Pipeline Zero loadConfig() Invocation with Snapshot Threading", () => {
		test("transcribeDetailed with threaded configSnapshot executes 0 loadConfig calls in normal STT", async () => {
			// Mock Gemini client to avoid external network calls
			const mockClient = {
				models: {
					generateContent: async () => ({
						text: "Hello world transcript",
					}),
				},
			};
			setGeminiClientForTests(mockClient);

			const currentConfig = defaultConfig();
			currentConfig.provider = "gemini";
			currentConfig.geminiModel = "gemini-3.1-flash-lite";
			currentConfig.translateEnabled = false;
			currentConfig.targetLanguage = "English";

			resetConfigAccessStats();

			const dummyAudio = new ArrayBuffer(1024);
			const result = await transcribeDetailed(dummyAudio, {
				provider: currentConfig.provider,
				geminiModel: currentConfig.geminiModel,
				dictationPreset: currentConfig.dictationPreset,
				translateEnabled: currentConfig.translateEnabled,
				targetLanguage: currentConfig.targetLanguage,
				customVocabulary: currentConfig.customVocabulary,
				presetVocabulary: currentConfig.presetVocabulary,
				dictionaryEntries: currentConfig.dictionaryEntries,
				symbolScannerEnabled: false,
				appPresetMappings: currentConfig.appPresetMappings,
				workspacePath: testRoot,
				configSnapshot: currentConfig,
				activeApp: "com.apple.Terminal",
			});

			expect(result.text).toBe("Hello world transcript");

			// Verify exactly 0 calls to loadConfig (0 cache hits, 0 cache misses, 0 lock acquisitions)!
			const stats = getConfigAccessStats();
			expect(stats.cacheHits + stats.cacheMisses).toBe(0);
			expect(stats.lockCount).toBe(0);
		});

		test("executeTwoStepTranslation with threaded configSnapshot executes 0 loadConfig calls across both stages", async () => {
			const currentConfig = defaultConfig();
			currentConfig.provider = "gemini";
			currentConfig.geminiModel = "gemini-3.1-flash-lite";
			currentConfig.translateEnabled = true;
			currentConfig.targetLanguage = "English";

			resetConfigAccessStats();

			const dummyAudio = new ArrayBuffer(1024);

			const result = await executeTwoStepTranslation(dummyAudio, {
				sourceProvider: "gemini",
				geminiModel: currentConfig.geminiModel,
				dictationPreset: "careful",
				targetLanguage: "English",
				symbolScannerEnabled: false,
				workspacePath: testRoot,
				appPresetMappings: currentConfig.appPresetMappings,
				configSnapshot: currentConfig,
				activeApp: "com.apple.Terminal",
				sourceTranscriber: async () => ({
					text: "မင်္ဂလာပါ",
					usedPaidKey: false,
					modelUsed: "gemini-3.1-flash-lite",
				}),
				textTranslator: async () => ({
					text: "Hello",
					modelUsed: "gemini-3.1-flash-lite",
					usedPaidKey: false,
				}),
			});

			expect(result.success).toBe(true);
			expect(result.finalText).toBe("Hello");

			// Verify exactly 0 calls to loadConfig during two-step translation!
			const stats = getConfigAccessStats();
			expect(stats.cacheHits + stats.cacheMisses).toBe(0);
			expect(stats.lockCount).toBe(0);
		});

		test("transcribeDetailed falls back cleanly to loadConfig when configSnapshot is omitted and uses in-memory cache", async () => {
			const mockClient = {
				models: {
					generateContent: async () => ({
						text: "Fallback test transcript",
					}),
				},
			};
			setGeminiClientForTests(mockClient);

			resetConfigAccessStats();

			const dummyAudio = new ArrayBuffer(1024);
			const result = await transcribeDetailed(dummyAudio, {
				provider: "gemini",
				symbolScannerEnabled: false,
				activeApp: "com.apple.Terminal",
			});

			expect(result.text).toBe("Fallback test transcript");

			// Without snapshot, loadConfig is invoked, but served via the in-memory cache after cold load
			const stats = getConfigAccessStats();
			expect(stats.cacheHits + stats.cacheMisses).toBeGreaterThanOrEqual(1);
		});
	});

	// =========================================================================
	// 4. Performance, Call-Count & Timing Optimization Suite
	// =========================================================================
	describe("4. Performance, Call-Count & Timing Optimization", () => {
		test("warm loadConfig calls execute in sub-millisecond time and avoid lockf subprocess spawning", () => {
			// First call (cold): establishes cache
			resetConfigAccessStats();
			const coldStart = performance.now();
			const coldConfig = loadConfig(testRoot);
			const coldDuration = performance.now() - coldStart;
			expect(coldConfig).toBeDefined();

			const statsAfterCold = getConfigAccessStats();
			expect(statsAfterCold.cacheMisses).toBe(1);
			expect(statsAfterCold.lockCount).toBe(1);

			// Spy on child_process.spawn to assert 0 subprocess spawns during warm calls
			const cp = require("node:child_process");
			let spawnCallCount = 0;
			const originalSpawn = cp.spawn;
			cp.spawn = (...args: any[]) => {
				spawnCallCount++;
				return originalSpawn.apply(cp, args);
			};

			try {
				const iterations = 20;
				const warmStart = performance.now();
				for (let i = 0; i < iterations; i++) {
					const cfg = loadConfig(testRoot);
					expect(cfg.provider).toBe("gemini");
				}
				const warmDuration = performance.now() - warmStart;
				const avgWarmTimeMs = warmDuration / iterations;

				// Assert zero lockf / flock subprocesses were spawned during warm calls!
				expect(spawnCallCount).toBe(0);

				// Assert all warm calls were served by the cache with zero locks acquired
				const statsAfterWarm = getConfigAccessStats();
				expect(statsAfterWarm.cacheHits).toBe(iterations);
				expect(statsAfterWarm.lockCount).toBe(1); // Only the initial cold call locked!

				// Assert warm calls are orders of magnitude faster than cold call
				expect(avgWarmTimeMs).toBeLessThan(1.0); // sub-millisecond average (< 1ms)
				expect(warmDuration).toBeLessThan(coldDuration * 2); // 20 warm calls take less than 2 cold calls
			} finally {
				cp.spawn = originalSpawn;
			}
		});
	});
});
