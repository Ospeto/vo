import { join } from "node:path";
import {
  loadAccuracyFixtureSuite,
  evaluateAccuracySuite,
  type AccuracySuiteReport,
} from "../src/services/transcription-accuracy-evaluator.js";

function runReport(): void {
  const args = process.argv.slice(2);
  let fixturePath = join(process.cwd(), "src", "__tests__", "fixtures", "accuracy-round6-eval.json");

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--fixture" && args[i + 1]) {
      fixturePath = args[i + 1]!;
      i++;
    }
  }

  console.log(`=== VO Transcription Accuracy Evaluation Round 6 ===`);
  console.log(`Loading fixture: ${fixturePath}`);

  const suite = loadAccuracyFixtureSuite(fixturePath);
  const report: AccuracySuiteReport = evaluateAccuracySuite(suite);

  console.log(`\nSuite: ${report.suiteDescription}`);
  console.log(`Total Cases: ${report.totalCases} | Passed: ${report.passedCases} | Failed: ${report.failedCases}`);
  console.log(`Average Accuracy: ${(report.averageAccuracy * 100).toFixed(2)}% | Average WER: ${(report.averageWordErrorRate * 100).toFixed(2)}%`);
  console.log(`Hits: ${report.totalHits} | Substitutions: ${report.totalSubstitutions} | Insertions: ${report.totalInsertions} | Deletions: ${report.totalDeletions} | Duplicated Fragments: ${report.totalDuplicatedFragments}`);

  console.log(`\n--- Category Summaries ---`);
  for (const catKey of Object.keys(report.categorySummaries)) {
    const cat = report.categorySummaries[catKey]!;
    console.log(`- ${cat.category.padEnd(25)} : ${cat.passedCount}/${cat.count} passed | Acc: ${(cat.averageAccuracy * 100).toFixed(1)}% | WER: ${(cat.averageWer * 100).toFixed(1)}% | (S:${cat.totalSubstitutions}, I:${cat.totalInsertions}, D:${cat.totalDeletions})`);
  }

  console.log(`\n--- Test Case Details ---`);
  for (const res of report.caseResults) {
    const status = res.passed ? "[PASS]" : "[FAIL]";
    console.log(`${status} ${res.caseId} (${res.category}): ${res.description}`);
    if (!res.passed || res.report.wordErrorRate > 0) {
      console.log(`   Expected: "${res.report.expectedText}"`);
      console.log(`   Actual  : "${res.report.actualText}"`);
      console.log(`   WER: ${(res.report.wordErrorRate * 100).toFixed(1)}% (S:${res.report.substitutions}, I:${res.report.insertions}, D:${res.report.deletions})`);
      if (res.report.duplicatedFragments.length > 0) {
        console.log(`   Duplicates: ${res.report.duplicatedFragments.map(d => `"${d.fragment}" (x${d.count})`).join(", ")}`);
      }
    }
  }

  if (report.failedCases > 0) {
    console.error(`\nAccuracy Evaluation Failed with ${report.failedCases} failure(s).`);
    process.exit(1);
  } else {
    console.log(`\nAll accuracy evaluation cases passed successfully!`);
  }
}

runReport();
