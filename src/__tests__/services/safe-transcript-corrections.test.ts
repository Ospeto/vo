import { describe, test, expect } from "bun:test";
import { sanitizeTranscribedText } from "../../services/stt.js";
import { DictionaryEngine, applyDictionary } from "../../services/dictionary-engine.js";
import type { DictionaryEntry } from "../../shared/types.js";

describe("VO Transcription-Accuracy Improvement Round 5: Safe Deterministic Post-Transcription Correction Layer", () => {
  describe("1. Spoken Command & Punctuation Boundary Safety", () => {
    test("does NOT match spoken 'comma' inside words like 'command' or 'commerce'", () => {
      expect(sanitizeTranscribedText("run the command line tool")).toBe("Run the command line tool");
      expect(sanitizeTranscribedText("e-commerce platform")).toBe("E-commerce platform");
    });

    test("does NOT match spoken 'bullet' inside words like 'bulletin'", () => {
      expect(sanitizeTranscribedText("bulletin board notice")).toBe("Bulletin board notice");
    });

    test("corrects standalone spoken punctuation commands cleanly", () => {
      expect(sanitizeTranscribedText("hello comma world")).toBe("Hello, world");
      expect(sanitizeTranscribedText("this is a test full stop")).toBe("This is a test။");
      expect(sanitizeTranscribedText("is it ready question mark")).toBe("Is it ready?");
      expect(sanitizeTranscribedText("look at this exclamation mark")).toBe("Look at this!");
      expect(sanitizeTranscribedText("note colon value")).toBe("Note: value");
      expect(sanitizeTranscribedText("first statement semicolon second statement")).toBe("First statement; second statement");
      expect(sanitizeTranscribedText("semicolons are useful")).toBe("Semicolons are useful");
    });

    test("corrects spoken Burmese punctuation commands accurately", () => {
      expect(sanitizeTranscribedText("အကြောင်းအရာ ပုဒ်မ အဆင်ပြေပါတယ် ပုဒ်ဖြတ်")).toBe("အကြောင်းအရာ။ အဆင်ပြေပါတယ်၊");
      expect(sanitizeTranscribedText("အကြောင်းအရာ ပုဒ်မဖြတ် နောက်တစ်ခု")).toBe("အကြောင်းအရာ။ နောက်တစ်ခု");
      expect(sanitizeTranscribedText("စက်ဖြတ် စာကြောင်း")).toBe("။ စာကြောင်း");
      expect(sanitizeTranscribedText("အဆင်ပြေလား မေးခွန်းသင်္ကေတ")).toBe("အဆင်ပြေလား?");
      expect(sanitizeTranscribedText("ဝမ်းသာပါတယ် အာမေဋိတ်")).toBe("ဝမ်းသာပါတယ်!");
    });
  });

  describe("2. Deduplication of Spoken Stutters & Duplicated Fragments", () => {
    test("removes consecutive duplicate English function words", () => {
      expect(sanitizeTranscribedText("the the database is ready")).toBe("The database is ready");
      expect(sanitizeTranscribedText("we we need to fix this")).toBe("We need to fix this");
      expect(sanitizeTranscribedText("it is is working")).toBe("It is working");
      expect(sanitizeTranscribedText("in in the file")).toBe("In the file");
    });

    test("preserves valid English duplicate word constructs (that that, had had)", () => {
      expect(sanitizeTranscribedText("he said that that was true")).toBe("He said that that was true");
      expect(sanitizeTranscribedText("i had had a cold")).toBe("I had had a cold");
    });

    test("removes multi-word exact duplicate fragments (2-5 words)", () => {
      expect(sanitizeTranscribedText("we need to we need to check the log")).toBe("We need to check the log");
      expect(sanitizeTranscribedText("check the database check the database for errors")).toBe("Check the database for errors");
      expect(sanitizeTranscribedText("အဆင်ပြေအောင် အဆင်ပြေအောင် ဆောင်ရွက်ပေးပါ")).toBe("အဆင်ပြေအောင် ဆောင်ရွက်ပေးပါ");
    });

    test("preserves repeated lines and code regions", () => {
      const repeatedLines = "const x = 1\nconst x = 1";
      expect(sanitizeTranscribedText(repeatedLines)).toBe("Const x = 1\nConst x = 1");
      expect(sanitizeTranscribedText("```\nconst x = 1\nconst x = 1\n```")).toBe("```\nConst x = 1\nConst x = 1\n```");
      expect(sanitizeTranscribedText("run `the the command` now")).toBe("Run `the the command` now");
    });

    test("preserves redoubled Burmese words without spaces (e.g. ကောင်းကောင်း, မြန်မြန်)", () => {
      expect(sanitizeTranscribedText("မြန်မြန် သွားပါ")).toBe("မြန်မြန် သွားပါ");
      expect(sanitizeTranscribedText("ကောင်းကောင်း လုပ်ပါ")).toBe("ကောင်းကောင်း လုပ်ပါ");
    });
  });

  describe("3. Punctuation Formatting & Spacing Normalization", () => {
    test("strips spaces before punctuation and fixes Burmese punctuation spacing", () => {
      expect(sanitizeTranscribedText("hello , world .")).toBe("Hello, world.");
      expect(sanitizeTranscribedText("အဆင်ပြေပါတယ် ။")).toBe("အဆင်ပြေပါတယ်။");
      expect(sanitizeTranscribedText("အဆင်ပြေပါတယ် ၊ နောက်တစ်ခု")).toBe("အဆင်ပြေပါတယ်၊ နောက်တစ်ခု");
    });

    test("collapses redundant consecutive punctuation marks", () => {
      expect(sanitizeTranscribedText("is it done??")).toBe("Is it done?");
      expect(sanitizeTranscribedText("great!!")).toBe("Great!");
      expect(sanitizeTranscribedText("အဆင်ပြေပါတယ်။။")).toBe("အဆင်ပြေပါတယ်။");
      expect(sanitizeTranscribedText("အဆင်ပြေပါတယ်၊၊")).toBe("အဆင်ပြေပါတယ်၊");
    });
  });

  describe("4. Preservation of Intentional Output & Domain Boundaries", () => {
    test("preserves technical identifiers, URLs, and code blocks unchanged", () => {
      expect(sanitizeTranscribedText("https://example.com/api/v1")).toBe("https://example.com/api/v1");
      expect(sanitizeTranscribedText("git@github.com:user/repo.git")).toBe("git@github.com:user/repo.git");
      expect(sanitizeTranscribedText("const userId = await getUser(id);")).toBe("Const userId = await getUser(id);");
    });

    test("preserves mixed-language dictation flow without forced translation or corruption", () => {
      const input = "Database connection ကို test လုပ်ပြီး တွေ့တဲ့ error ကို log ထုတ်ပေး";
      expect(sanitizeTranscribedText(input)).toBe(input);
    });

    test("respects terminal / CLI window environment formatting rules", () => {
      expect(sanitizeTranscribedText("git status.", "Ghostty")).toBe("Git status");
      expect(sanitizeTranscribedText("bun test.", "Terminal")).toBe("Bun test");
    });
  });

  describe("5. Trusted Dictionary Determinism & Provider-Agnostic Contract", () => {
    test("applies trusted dictionary entries exact, bounded, and non-recursively", () => {
      const entries: DictionaryEntry[] = [
        { id: "1", phrase: "SarYayKaung", spokenAliases: ["စာရေးကောင်း"], enabled: true, category: "general" },
        { id: "2", phrase: "MAS 141", spokenAliases: ["မက်စ် ၁၄၁"], enabled: true, category: "technical" },
      ];

      const raw = "စာရေးကောင်း က မက်စ် ၁၄၁ အကြောင်း ပြောသည်";
      const result = sanitizeTranscribedText(raw, "Ghostty", "careful", entries);

      expect(result).toBe("SarYayKaung က MAS 141 အကြောင်း ပြောသည်");
    });

    test("preserves original text when no exact dictionary match applies", () => {
      const entries: DictionaryEntry[] = [
        { id: "1", phrase: "SarYayKaung", spokenAliases: ["စာရေးကောင်း"], enabled: true, category: "general" },
      ];

      const unmapped = "ဒီနေ့ ရာသီဥတု အလွန် သာယာပါသည်";
      const result = sanitizeTranscribedText(unmapped, "Ghostty", "careful", entries);

      expect(result).toBe(unmapped);
    });
  });
});
