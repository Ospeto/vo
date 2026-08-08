import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { PasteCoordinator } from "../../services/paste-flow.js";
import { RecordingLifecycle } from "../../services/recording-lifecycle.js";
import {
	SafePasteService,
	type ClipboardSnapshot,
	type SafePasteDiagnostic,
	type TargetIdentity,
} from "../../services/safe-paste.js";
import {
	sendCommand,
	validateDaemonResponse,
} from "../../services/daemon-ipc.js";
import {
	readRuntimeStateResult,
	removeRuntimeStateIfRevision,
	saveRuntimeState,
	setRuntimeStateDirectoryForTests,
} from "../../services/runtime-state.js";

const target: TargetIdentity = {
	bundleId: "com.example.Editor",
	appName: "Editor",
	pid: 123,
	windowId: 456,
	windowTitle: "Draft",
};

const assertSanitizedDiagnosticSchema = (
	records: SafePasteDiagnostic[],
): void => {
	const allowedKeys = new Set([
		"operationId",
		"stage",
		"durationMs",
		"targetMode",
		"outcome",
		"reason",
	]);
	const forbiddenKeys = new Set([
		"bundleId",
		"appName",
		"pid",
		"windowId",
		"windowTitle",
		"elementId",
		"role",
		"subrole",
		"args",
		"command",
		"helper",
	]);
	for (const record of records) {
		const keys = Object.keys(record);
		expect(keys.every((key) => allowedKeys.has(key))).toBe(true);
		expect(keys.filter((key) => forbiddenKeys.has(key))).toEqual([]);
	}
};

let servers: Server[] = [];
let directories: string[] = [];

afterEach(async () => {
	await Promise.all(
		servers.map(
			(server) => new Promise<void>((resolve) => server.close(() => resolve())),
		),
	);
	servers = [];
	for (const directory of directories)
		rmSync(directory, { recursive: true, force: true });
	directories = [];
	setRuntimeStateDirectoryForTests(null);
});

describe.serial("macOS safety reliability integration smoke", () => {
	test("authorizes same-process window ID shifts between capture and paste", async () => {
		let activeWindowTarget: TargetIdentity | null = {
			...target,
			windowId: 100,
			windowTitle: "Original Window",
		};
		let injectedCalls = 0;
		let currentClipboardText = "user original clipboard text";

		const clipboardAdapter = {
			readText: () => currentClipboardText,
			writeText: (text: string) => {
				currentClipboardText = text;
			},
			snapshot: () => ({ text: currentClipboardText, formats: [] }),
			restore: (snapshot: ClipboardSnapshot) => {
				currentClipboardText = snapshot.text ?? "";
			},
		};

		const pasteService = new SafePasteService(
			() => activeWindowTarget,
			async () => {
				injectedCalls++;
			},
			clipboardAdapter,
		);

		const lifecycle = new RecordingLifecycle();
		const coordinator = new PasteCoordinator((text) =>
			pasteService.paste(text),
		);

		// 1. Capture target before recording starts
		const startRes = lifecycle.requestStart();
		expect(startRes.accepted).toBe(true);
		pasteService.captureTarget();
		lifecycle.acknowledgeStart(startRes.sequenceId, true);

		// 2. Stop recording and transition to transcribing
		const stopRes = lifecycle.requestStop();
		expect(stopRes.accepted).toBe(true);
		lifecycle.acknowledgeStop(stopRes.sequenceId, true);

		// 3. Same-process window ID shift (e.g. Electron window / tab shift within same pid)
		activeWindowTarget = {
			...target,
			windowId: 999,
			windowTitle: "Editor - Second Window",
		};

		// 4. Transcription finishes and paste is attempted
		const pasteRes = await coordinator.pasteText("dictated text");

		// 5. Verify successful submission and injection
		expect(pasteRes).toEqual({ status: "submitted" });
		expect(injectedCalls).toBe(1);
		expect(currentClipboardText).toBe("user original clipboard text");

		// 6. Verify lifecycle finishes transcription cleanly
		expect(
			lifecycle.finishTranscription(stopRes.sequenceId, true).accepted,
		).toBe(true);
		expect(lifecycle.snapshot().state).toBe("idle");
	});

	test("rejects cross-app target switches between capture and paste without wrong-target injection or clipboard corruption", async () => {
		let activeWindowTarget: TargetIdentity | null = {
			...target,
			windowId: 100,
			windowTitle: "Original Window",
		};
		let injectedCalls = 0;
		let currentClipboardText = "user original clipboard text";

		const clipboardAdapter = {
			readText: () => currentClipboardText,
			writeText: (text: string) => {
				currentClipboardText = text;
			},
			snapshot: () => ({ text: currentClipboardText, formats: [] }),
			restore: (snapshot: ClipboardSnapshot) => {
				currentClipboardText = snapshot.text ?? "";
			},
		};

		const pasteService = new SafePasteService(
			() => activeWindowTarget,
			async () => {
				injectedCalls++;
			},
			clipboardAdapter,
		);

		const lifecycle = new RecordingLifecycle();
		const coordinator = new PasteCoordinator((text) =>
			pasteService.paste(text),
		);

		// 1. Capture target before recording starts
		const startRes = lifecycle.requestStart();
		expect(startRes.accepted).toBe(true);
		pasteService.captureTarget();
		lifecycle.acknowledgeStart(startRes.sequenceId, true);

		// 2. Stop recording and transition to transcribing
		const stopRes = lifecycle.requestStop();
		expect(stopRes.accepted).toBe(true);
		lifecycle.acknowledgeStop(stopRes.sequenceId, true);

		// 3. User switches to a different application (e.g. Terminal / 1Password)
		activeWindowTarget = {
			bundleId: "com.apple.Terminal",
			appName: "Terminal",
			pid: 888,
			windowId: 999,
			windowTitle: "Terminal - zsh",
		};

		// 4. Transcription finishes and paste is attempted
		const pasteRes = await coordinator.pasteText("dictated confidential text");

		// 5. Verify rejection, no injection, no clipboard corruption
		expect(pasteRes).toEqual({ status: "denied", reason: "target_mismatch" });
		expect(injectedCalls).toBe(0);
		expect(currentClipboardText).toBe("user original clipboard text");

		// 6. Verify lifecycle handles failure safely
		expect(
			lifecycle.finishTranscription(stopRes.sequenceId, false).accepted,
		).toBe(true);
		expect(lifecycle.snapshot().state).toBe("error");
	});

	test("keeps a newer lifecycle safe from stale renderer acknowledgements and rejects transient toggles", () => {
		const lifecycle = new RecordingLifecycle();
		const first = lifecycle.requestToggle();
		expect(lifecycle.requestToggle().accepted).toBe(false);
		lifecycle.reset();
		const second = lifecycle.requestToggle();

		expect(lifecycle.acknowledgeStart(first.sequenceId, true).accepted).toBe(
			false,
		);
		expect(lifecycle.snapshot().sequenceId).toBe(second.sequenceId);
		expect(lifecycle.acknowledgeStart(second.sequenceId, true).accepted).toBe(
			true,
		);
		const stop = lifecycle.requestToggle();
		expect(lifecycle.acknowledgeStop(stop.sequenceId, true).accepted).toBe(
			true,
		);
		expect(lifecycle.requestToggle().accepted).toBe(false);
		expect(
			lifecycle.finishTranscription(stop.sequenceId + 1, true).accepted,
		).toBe(false);
		expect(lifecycle.snapshot().state).toBe("transcribing");
	});

	test("retains transcript without injection when target validation or conditional paste fails", async () => {
		let current: TargetIdentity | null = target;
		let injected = 0;
		const clipboard = {
			readText: () => "old clipboard",
			writeText: (_text: string) => {},
			snapshot: () => ({ text: "old clipboard", formats: [] }),
			restore: (_snapshot: ClipboardSnapshot) => {},
		};
		const paste = new SafePasteService(
			() => current,
			async () => {
				injected++;
				throw new Error("conditional paste rejected");
			},
			clipboard,
		);
		paste.captureTarget();
		current = target;
		expect((await paste.paste("transcript")).ok).toBe(false);
		expect(injected).toBe(1);

		current = target;
		paste.captureTarget();
		expect((await paste.paste("secret transcript")).ok).toBe(false);
		expect(injected).toBe(2);

		const lifecycle = new RecordingLifecycle();
		const start = lifecycle.requestStart();
		lifecycle.acknowledgeStart(start.sequenceId, true);
		const stop = lifecycle.requestStop();
		lifecycle.acknowledgeStop(stop.sequenceId, true);
		const coordinator = new PasteCoordinator((text, isCurrent) =>
			paste.paste(text, isCurrent),
		);
		const result = await coordinator.pasteText("retained transcript");
		expect(result).toMatchObject({ status: "denied" });
		expect(lifecycle.finishTranscription(stop.sequenceId, false)).toMatchObject(
			{ accepted: true, state: "error" },
		);
		expect(lifecycle.finishTranscription(stop.sequenceId, true).accepted).toBe(
			false,
		);
	});

	test("does not settle lifecycle or apply stale paste effects after renderer teardown", async () => {
		const lifecycle = new RecordingLifecycle();
		const start = lifecycle.requestStart();
		lifecycle.acknowledgeStart(start.sequenceId, true);
		const stop = lifecycle.requestStop();
		lifecycle.acknowledgeStop(stop.sequenceId, true);

		let release!: () => void;
		const pendingPaste = new Promise<void>((resolve) => {
			release = resolve;
		});
		let injected = 0;
		const clipboard = {
			readText: () => "old clipboard",
			writeText: (_text: string) => {},
			snapshot: () => ({ text: "old clipboard", formats: [] }),
			restore: (_snapshot: ClipboardSnapshot) => {},
		};
		const paste = new SafePasteService(
			() => target,
			async (_expected, isCurrent) => {
				await pendingPaste;
				if (isCurrent()) injected++;
			},
			clipboard,
		);
		paste.captureTarget();
		const coordinator = new PasteCoordinator((text, isCurrent) =>
			paste.paste(text, isCurrent),
		);
		const pending = coordinator.pasteText("teardown transcript");

		expect(lifecycle.shutdown().accepted).toBe(true);
		const teardownSnapshot = lifecycle.snapshot();
		coordinator.invalidate();
		release();

		expect(await pending).toEqual({
			status: "stale",
			reason: "Paste invalidated; transcript was retained",
		});
		expect(injected).toBe(0);
		expect(lifecycle.finishTranscription(stop.sequenceId, true).accepted).toBe(
			false,
		);
		expect(lifecycle.snapshot()).toEqual(teardownSnapshot);
	});

	test("settles successful paste and lifecycle only for the matching sequence", async () => {
		const lifecycle = new RecordingLifecycle();
		const start = lifecycle.requestStart();
		lifecycle.acknowledgeStart(start.sequenceId, true);
		const stop = lifecycle.requestStop();
		lifecycle.acknowledgeStop(stop.sequenceId, true);
		const current: TargetIdentity | null = target;
		let injectedTarget: TargetIdentity | null = null;
		const records: SafePasteDiagnostic[] = [];
		let clipboardText = "old clipboard";
		const clipboard = {
			readText: () => clipboardText,
			writeText: (text: string) => {
				clipboardText = text;
			},
			snapshot: () => ({ text: clipboardText, formats: [] }),
			restore: (snapshot: ClipboardSnapshot) => {
				clipboardText = snapshot.text ?? "";
			},
		};
		const paste = new SafePasteService(
			() => current,
			async (expected) => {
				injectedTarget = expected;
			},
			clipboard,
			undefined,
			{ emit: (diagnostic) => records.push(diagnostic) },
		);
		paste.captureTarget();
		const outcomes: Array<{ ok: boolean; reason: string }> = [];
		const coordinator = new PasteCoordinator(async (text) => {
			const outcome = await paste.paste(text);
			outcomes.push(outcome);
			return outcome;
		});

		expect(await coordinator.pasteText("hello")).toEqual({
			status: "submitted",
		});
		expect(outcomes).toEqual([{ ok: true, reason: "injection_requested" }]);
		expect(injectedTarget!).toEqual(target);
		expect(clipboardText).toBe("old clipboard");
		expect(records.map(({ stage }) => stage)).toEqual([
			"target_capture",
			"target_recheck",
			"clipboard_snapshot",
			"clipboard_write",
			"injection",
			"clipboard_hold",
			"clipboard_restore",
			"total",
		]);
		expect(
			records.every(
				(record) =>
					Number.isFinite(record.durationMs) &&
					record.durationMs >= 0 &&
					record.targetMode === "window" &&
					typeof record.operationId === "string",
			),
		).toBe(true);
		expect(JSON.stringify(records)).not.toContain("hello");
		const serialized = JSON.stringify(records);
		expect(serialized).not.toContain("old clipboard");
		assertSanitizedDiagnosticSchema(records);
		expect(
			lifecycle.finishTranscription(stop.sequenceId + 1, true).accepted,
		).toBe(false);
		expect(lifecycle.finishTranscription(stop.sequenceId, true)).toMatchObject({
			accepted: true,
			state: "idle",
		});
	});

	test.each([
		["app change", { ...target, appName: "Other" }, "target_mismatch"],
		[
			"bundle ID change",
			{ ...target, bundleId: "com.other.Editor" },
			"target_mismatch",
		],
		["pid change", { ...target, pid: 124 }, "target_mismatch"],
		["target disappearance", null, "target_unavailable"],
	] as const)(
		"retains transcript when %s occurs",
		async (_change, current, reason) => {
			const records: SafePasteDiagnostic[] = [];
			let clipboardText = "old clipboard";
			let injected = 0;
			const clipboard = {
				readText: () => clipboardText,
				writeText: (text: string) => {
					clipboardText = text;
				},
				snapshot: () => ({ text: clipboardText, formats: [] }),
				restore: (snapshot: ClipboardSnapshot) => {
					clipboardText = snapshot.text ?? "";
				},
			};
			let active: TargetIdentity | null = target;
			const paste = new SafePasteService(
				() => active,
				async () => {
					injected++;
				},
				clipboard,
				undefined,
				{ emit: (diagnostic) => records.push(diagnostic) },
			);
			paste.captureTarget();
			active = current;

			expect(await paste.paste("retained transcript")).toEqual({
				ok: false,
				reason,
			});
			expect(injected).toBe(0);
			expect(clipboardText).toBe("old clipboard");
			expect(records.at(-1)).toMatchObject({
				stage: "total",
				outcome: "failure",
				reason,
				targetMode: "window",
			});
			const serialized = JSON.stringify(records);
			expect(serialized).not.toContain("retained transcript");
			expect(serialized).not.toContain("old clipboard");
			assertSanitizedDiagnosticSchema(records);
		},
	);

	test.each(["injection_rejected"] as const)(
		"retains transcript after native injection %s",
		async (reason) => {
			const records: SafePasteDiagnostic[] = [];
			let clipboardText = "old clipboard";
			const clipboard = {
				readText: () => clipboardText,
				writeText: (text: string) => {
					clipboardText = text;
				},
				snapshot: () => ({ text: clipboardText, formats: [] }),
				restore: (snapshot: ClipboardSnapshot) => {
					clipboardText = snapshot.text ?? "";
				},
			};
			const paste = new SafePasteService(
				() => target,
				async () => {
					throw Object.assign(new Error("native injection failed"), { reason });
				},
				clipboard,
				undefined,
				{ emit: (diagnostic) => records.push(diagnostic) },
			);
			paste.captureTarget();

			const lifecycle = new RecordingLifecycle();
			const start = lifecycle.requestStart();
			lifecycle.acknowledgeStart(start.sequenceId, true);
			const stop = lifecycle.requestStop();
			lifecycle.acknowledgeStop(stop.sequenceId, true);
			const coordinator = new PasteCoordinator((text) => paste.paste(text));
			const result = await coordinator.pasteText("native failure transcript");
			expect(result).toEqual({ status: "denied", reason });
			expect(
				lifecycle.finishTranscription(stop.sequenceId, false),
			).toMatchObject({ accepted: true, state: "error" });
			expect(
				lifecycle.finishTranscription(stop.sequenceId, true).accepted,
			).toBe(false);
			expect(clipboardText).toBe("old clipboard");
			const injection = records.find((record) => record.stage === "injection");
			expect(injection?.stage).toBe("injection");
			expect(typeof injection?.durationMs).toBe("number");
			expect(injection?.durationMs).toBeGreaterThanOrEqual(0);
			expect(injection?.outcome).toBe("failure");
			expect(injection?.reason).toBe(reason);
			expect(typeof injection?.operationId).toBe("string");
			expect(injection?.targetMode).toBe("window");
			expect(
				records.every(
					(record) =>
						Number.isFinite(record.durationMs) && record.durationMs >= 0,
				),
			).toBe(true);
			const serialized = JSON.stringify(records);
			expect(serialized).not.toContain("native failure transcript");
			expect(serialized).not.toContain("old clipboard");
			assertSanitizedDiagnosticSchema(records);
		},
	);

	test.each([
		["Terminal", "com.apple.Terminal"],
		["Telegram", "org.telegram.desktop"],
		["Myanso", "com.example.myanso"],
	])(
		"keeps ordinary %s targets eligible despite secure-looking field metadata",
		async (appName, bundleId) => {
			const fixture = {
				...target,
				appName,
				bundleId,
				role: "AXSecureTextField",
				subrole: "AXPasswordField",
			} as TargetIdentity;
			let injected = 0;
			const clipboard = {
				readText: () => "old",
				writeText: () => {},
				snapshot: () => ({ text: "old", formats: [] }),
				restore: () => {},
			};
			const paste = new SafePasteService(
				() => fixture,
				async () => {
					injected++;
				},
				clipboard,
			);
			paste.captureTarget();
			expect(await paste.paste("ordinary transcript")).toEqual({
				ok: true,
				reason: "injection_requested",
			});
			expect(injected).toBe(1);
		},
	);

	test("rejects malformed daemon responses and verifies shutdown ownership before action", async () => {
		expect(() => validateDaemonResponse({ ok: true }, "status")).toThrow(
			"Invalid daemon status",
		);
		expect(() =>
			validateDaemonResponse(
				{ ok: true, state: "idle", cwd: "/tmp", pid: 1, uptime: -1 },
				"status",
			),
		).toThrow();

		const socketPath = join(
			tmpdir(),
			`pi-voice-smoke-${Date.now()}-${Math.random()}.sock`,
		);
		const server = createServer((connection) => {
			connection.on("data", (data) => {
				const request = JSON.parse(data.toString()) as {
					command: string;
					expectedPid?: number;
				};
				if (request.command === "status") connection.write('{"ok":true}\n');
				else
					connection.write(
						JSON.stringify(
							request.expectedPid === 321
								? { ok: true }
								: { ok: false, error: "ownership mismatch" },
						) + "\n",
					);
			});
		});
		servers.push(server);
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(socketPath, resolve);
		});
		await expect(sendCommand("status", socketPath, 100)).rejects.toThrow(
			"Invalid response",
		);
		await expect(
			sendCommand("shutdown", 999, socketPath, 100),
		).resolves.toEqual({ ok: false, error: "ownership mismatch" });
		await expect(
			sendCommand("shutdown", 321, socketPath, 100),
		).resolves.toEqual({ ok: true });
	});

	test("does not let an old runtime revision erase its replacement or discard unavailable state", () => {
		const directory = join(
			tmpdir(),
			`pi-voice-runtime-smoke-${Date.now()}-${Math.random()}`,
		);
		mkdirSync(directory, { recursive: true });
		directories.push(directory);
		setRuntimeStateDirectoryForTests(directory);
		const old = saveRuntimeState("/tmp/old");
		const replacement = saveRuntimeState("/tmp/replacement");

		expect(removeRuntimeStateIfRevision(old.revision)).toEqual({
			ok: true,
			removed: false,
		});
		expect(readRuntimeStateResult()).toMatchObject({
			kind: "present",
			revision: replacement.revision,
			state: { cwd: "/tmp/replacement" },
		});

		writeFileSync(
			join(directory, "runtime-state.json"),
			JSON.stringify({
				version: 1,
				instanceId: randomUUID(),
				pid: 99_999_999,
				cwd: "/tmp/unavailable-daemon",
				startedAt: new Date().toISOString(),
			}) + "\n",
		);
		expect(readRuntimeStateResult()).toMatchObject({
			kind: "present",
			liveness: "dead",
			state: { cwd: "/tmp/unavailable-daemon" },
		});
		expect(existsSync(join(directory, "runtime-state.json"))).toBe(true);
	});
});
