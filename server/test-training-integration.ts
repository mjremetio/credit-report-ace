/**
 * Training Integration Test
 *
 * Verifies that AI training data (learned patterns + training examples)
 * is effectively integrated into the violation detection system prompt.
 * Tests the feedback loop: confirmed patterns boost detection,
 * rejected patterns suppress false positives.
 */

import { buildSystemPrompt } from "./ai-services";
import type { NegativeAccount, ViolationPattern, FcraTrainingExample } from "@shared/schema";

// ── Mock data ──────────────────────────────────────────────────────

function mockAccount(overrides: Partial<NegativeAccount> = {}): NegativeAccount {
  return {
    id: 1,
    scanId: 1,
    creditor: "MIDLAND CREDIT MANAGEMENT",
    accountNumber: "MCM****9012",
    accountType: "debt_collection",
    originalCreditor: "CAPITAL ONE",
    balance: "1890",
    status: "Collection",
    dateOpened: "2023-01",
    dateOfDelinquency: "2022-09",
    bureaus: "TransUnion, Experian",
    rawDetails: null,
    workflowStep: "scanned",
    createdAt: new Date(),
    ...overrides,
  } as NegativeAccount;
}

function mockPattern(overrides: Partial<ViolationPattern> = {}): ViolationPattern {
  return {
    id: 1,
    violationType: "Balance Mismatch Across Bureaus",
    matchedRule: "BALANCE_MISMATCH_CROSS_BUREAU",
    category: "FCRA_REPORTING",
    severity: "high",
    accountType: "debt_collection",
    creditorPattern: "MIDLAND CREDIT MANAGEMENT",
    evidencePattern: "TransUnion balance=$1890, Experian balance=$1500",
    fcraStatute: "§1681e(b)",
    confidence: "confirmed",
    timesConfirmed: 10,
    timesRejected: 1,
    lastConfirmedAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  } as ViolationPattern;
}

function mockTrainingExample(overrides: Partial<FcraTrainingExample> = {}): FcraTrainingExample {
  return {
    id: 1,
    violationType: "BALANCE_PAID_NOT_ZERO",
    category: "FCRA_REPORTING",
    severity: "high",
    fcraStatute: "§1681e(b)",
    accountType: "debt_collection",
    title: "Paid Collection Still Showing Balance — Midland Credit",
    scenario: "Account: MIDLAND CREDIT (Debt Collection). Paid collection but Experian still reports $450 balance.",
    expectedEvidence: "TransUnion=$0, Equifax=$0, Experian=$450",
    expectedExplanation: "Paid collection should show $0 balance across all bureaus",
    reportExcerpt: null,
    commonMistakes: "Do not flag if only one bureau has reported the payment update",
    keyIndicators: "BALANCE_STATUS_CONTRADICTION",
    caseLawReference: "Cushman v. Trans Union Corp.",
    regulatoryGuidance: "CFPB Bulletin 2013-09",
    isActive: true,
    source: "confirmed_scan",
    sourceScanId: 1,
    createdBy: "test-reviewer",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as FcraTrainingExample;
}

// ── Tests ──────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

function testBasePromptWithNoTraining() {
  console.log("\n=== TEST: Base prompt with no training data ===\n");

  const account = mockAccount();
  const prompt = buildSystemPrompt(account);

  assert(prompt.includes("You are LEXA"), "Contains LEXA system prompt");
  assert(!prompt.includes("LEARNED VIOLATION PATTERNS"), "No learned patterns section");
  assert(!prompt.includes("FALSE POSITIVE PATTERNS"), "No false positive section");
  assert(!prompt.includes("FCRA TRAINING EXAMPLES"), "No training examples section");
}

function testConfirmedPatternsInjected() {
  console.log("\n=== TEST: Confirmed patterns are injected into prompt ===\n");

  const account = mockAccount();
  const patterns = [
    mockPattern({ timesConfirmed: 10, timesRejected: 1 }),
    mockPattern({ id: 2, violationType: "Missing Original Creditor", matchedRule: "MISSING_ORIGINAL_CREDITOR", timesConfirmed: 5, timesRejected: 0 }),
  ];

  const prompt = buildSystemPrompt(account, patterns);

  assert(prompt.includes("LEARNED VIOLATION PATTERNS"), "Contains learned patterns section");
  assert(prompt.includes("Balance Mismatch Across Bureaus"), "Contains first pattern");
  assert(prompt.includes("Missing Original Creditor"), "Contains second pattern");
  assert(prompt.includes("HIGH CONFIDENCE"), "Includes confidence weighting");
  assert(prompt.includes("confirmed 10/11 reviews"), "Shows confirmation stats");
  assert(prompt.includes("91% accuracy"), "Shows accuracy percentage");
}

function testRejectedPatternsCreateFalsePositiveWarnings() {
  console.log("\n=== TEST: Rejected patterns create false-positive warnings ===\n");

  const account = mockAccount();
  const patterns = [
    // This pattern is mostly rejected — should appear in false positive section
    mockPattern({
      id: 3,
      violationType: "Credit Limit Mismatch",
      matchedRule: "CREDIT_LIMIT_MISMATCH_CROSS_BUREAU",
      timesConfirmed: 2,
      timesRejected: 8,
    }),
    // This one is confirmed — should appear in confirmed section
    mockPattern({ timesConfirmed: 10, timesRejected: 1 }),
  ];

  const prompt = buildSystemPrompt(account, patterns);

  assert(prompt.includes("FALSE POSITIVE PATTERNS"), "Contains false positive section");
  assert(prompt.includes("Credit Limit Mismatch"), "Rejected pattern is in false positive list");
  assert(prompt.includes("rejected 8/10 reviews"), "Shows rejection stats");
  assert(prompt.includes("AVOID flagging"), "Contains warning to avoid");
  assert(prompt.includes("LEARNED VIOLATION PATTERNS"), "Still has confirmed patterns section");
  assert(prompt.includes("Balance Mismatch Across Bureaus"), "Confirmed pattern still present");
}

function testTrainingExamplesInjected() {
  console.log("\n=== TEST: Training examples are injected into prompt ===\n");

  const account = mockAccount();
  const examples = [
    mockTrainingExample(),
    mockTrainingExample({
      id: 2,
      violationType: "MISSING_ORIGINAL_CREDITOR",
      title: "Collection Without OC — Portfolio Recovery",
      scenario: "Portfolio Recovery reports collection without identifying original creditor",
      expectedEvidence: "No original creditor listed on any bureau",
      commonMistakes: "Check if OC is listed in remarks",
      caseLawReference: "Brady v. Credit Recovery Co.",
    }),
  ];

  const prompt = buildSystemPrompt(account, [], examples);

  assert(prompt.includes("FCRA TRAINING EXAMPLES"), "Contains training examples section");
  assert(prompt.includes("Paid Collection Still Showing Balance"), "Contains first example title");
  assert(prompt.includes("Collection Without OC"), "Contains second example title");
  assert(prompt.includes("Cushman v. Trans Union Corp."), "Contains case law reference");
  assert(prompt.includes("CFPB Bulletin 2013-09"), "Contains regulatory guidance");
  assert(prompt.includes("Do not flag if only one bureau"), "Contains common mistakes");
  assert(prompt.includes("Brady v. Credit Recovery Co."), "Contains second example case law");
}

function testInactiveExamplesExcluded() {
  console.log("\n=== TEST: Inactive training examples are excluded ===\n");

  const account = mockAccount();
  const examples = [
    mockTrainingExample({ isActive: true, title: "Active Example" }),
    mockTrainingExample({ id: 2, isActive: false, title: "Inactive Example" }),
  ];

  const prompt = buildSystemPrompt(account, [], examples);

  assert(prompt.includes("Active Example"), "Active example included");
  assert(!prompt.includes("Inactive Example"), "Inactive example excluded");
}

function testWrongAccountTypeExcluded() {
  console.log("\n=== TEST: Wrong account type patterns are excluded ===\n");

  const account = mockAccount({ accountType: "debt_collection" });
  const patterns = [
    mockPattern({ accountType: "debt_collection", violationType: "Relevant Pattern" }),
    mockPattern({ id: 2, accountType: "charge_off", violationType: "Irrelevant Pattern" }),
  ];

  const prompt = buildSystemPrompt(account, patterns);

  assert(prompt.includes("Relevant Pattern"), "Matching account type pattern included");
  assert(!prompt.includes("Irrelevant Pattern"), "Non-matching account type pattern excluded");
}

function testCompactPromptUsedWithRuleFlags() {
  console.log("\n=== TEST: Compact prompt used when rule-based flags present ===\n");

  const account = mockAccount({
    rawDetails: JSON.stringify({
      account: { creditor: "TEST" },
      ruleBasedFlags: [{ type: "BALANCE_MISMATCH", severity: "high" }],
    }),
  });

  const prompt = buildSystemPrompt(account);

  assert(prompt.includes("ALREADY been processed by a deterministic rule engine"), "Uses compact prompt");
  assert(!prompt.includes("ANALYSIS CHECKLIST"), "Does not include full checklist");
}

function testCompactPromptStillGetsTraining() {
  console.log("\n=== TEST: Compact prompt still receives training data ===\n");

  const account = mockAccount({
    rawDetails: JSON.stringify({
      account: { creditor: "TEST" },
      ruleBasedFlags: [{ type: "BALANCE_MISMATCH" }],
    }),
  });
  const patterns = [mockPattern({ timesConfirmed: 5, timesRejected: 0 })];
  const examples = [mockTrainingExample()];

  const prompt = buildSystemPrompt(account, patterns, examples);

  assert(prompt.includes("ALREADY been processed"), "Uses compact prompt");
  assert(prompt.includes("LEARNED VIOLATION PATTERNS"), "Training patterns still injected");
  assert(prompt.includes("FCRA TRAINING EXAMPLES"), "Training examples still injected");
}

function testConfidenceWeightCategories() {
  console.log("\n=== TEST: Confidence weight categories are correct ===\n");

  const account = mockAccount();
  const patterns = [
    mockPattern({ id: 1, violationType: "High Acc Pattern", timesConfirmed: 19, timesRejected: 1 }), // 95% -> HIGH
    mockPattern({ id: 2, violationType: "Med Acc Pattern", matchedRule: "MED", timesConfirmed: 8, timesRejected: 3 }), // 73% -> MODERATE
    mockPattern({ id: 3, violationType: "Low Acc Pattern", matchedRule: "LOW", timesConfirmed: 6, timesRejected: 4 }), // 60% -> LOW
  ];

  const prompt = buildSystemPrompt(account, patterns);

  assert(prompt.includes("[HIGH CONFIDENCE] High Acc Pattern"), "95% accuracy -> HIGH CONFIDENCE");
  assert(prompt.includes("[MODERATE CONFIDENCE] Med Acc Pattern"), "73% accuracy -> MODERATE CONFIDENCE");
  assert(prompt.includes("[LOW CONFIDENCE] Low Acc Pattern"), "60% accuracy -> LOW CONFIDENCE");
}

function testFullTrainingIntegration() {
  console.log("\n=== TEST: Full integration — patterns + examples + false positives ===\n");

  const account = mockAccount();

  const patterns = [
    // Confirmed high-confidence pattern
    mockPattern({
      id: 1,
      violationType: "Balance Mismatch",
      matchedRule: "BALANCE_MISMATCH",
      timesConfirmed: 15,
      timesRejected: 1,
    }),
    // Rejected false-positive pattern
    mockPattern({
      id: 2,
      violationType: "Terms Mismatch",
      matchedRule: "TERMS_MISMATCH",
      timesConfirmed: 1,
      timesRejected: 7,
    }),
  ];

  const examples = [
    mockTrainingExample({
      title: "Balance Paid Not Zero — Real Case",
      commonMistakes: "Don't flag partial payments as violations",
    }),
  ];

  const prompt = buildSystemPrompt(account, patterns, examples);

  // Verify all three sections are present
  assert(prompt.includes("LEARNED VIOLATION PATTERNS"), "Has confirmed patterns section");
  assert(prompt.includes("FALSE POSITIVE PATTERNS"), "Has false positive section");
  assert(prompt.includes("FCRA TRAINING EXAMPLES"), "Has training examples section");

  // Verify correct assignment
  assert(prompt.includes("Balance Mismatch") && prompt.includes("HIGH CONFIDENCE"), "Confirmed pattern has correct weight");
  assert(prompt.includes("Terms Mismatch") && prompt.includes("FALSE POSITIVE"), "Rejected pattern in false positive section");
  assert(prompt.includes("Don't flag partial payments"), "Training example common mistakes included");

  // Verify the sections appear in the correct order (patterns -> false positives -> examples)
  const patternIdx = prompt.indexOf("LEARNED VIOLATION PATTERNS");
  const fpIdx = prompt.indexOf("FALSE POSITIVE PATTERNS");
  const exIdx = prompt.indexOf("FCRA TRAINING EXAMPLES");
  assert(patternIdx < fpIdx, "Confirmed patterns appear before false positives");
  assert(fpIdx < exIdx, "False positives appear before training examples");
}

// ── Run all tests ──────────────────────────────────────────────────

function runTests() {
  console.log("╔════════════════════════════════════════════════╗");
  console.log("║   AI Training Integration Effectiveness Test   ║");
  console.log("╚════════════════════════════════════════════════╝");

  testBasePromptWithNoTraining();
  testConfirmedPatternsInjected();
  testRejectedPatternsCreateFalsePositiveWarnings();
  testTrainingExamplesInjected();
  testInactiveExamplesExcluded();
  testWrongAccountTypeExcluded();
  testCompactPromptUsedWithRuleFlags();
  testCompactPromptStillGetsTraining();
  testConfidenceWeightCategories();
  testFullTrainingIntegration();

  console.log("\n╔════════════════════════════════════════════════╗");
  console.log("║                 TEST RESULTS                   ║");
  console.log("╚════════════════════════════════════════════════╝");
  console.log(`\n  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);

  if (failed === 0) {
    console.log("\n  ✓ ALL TESTS PASSED — AI training integration is working correctly!\n");
  } else {
    console.log(`\n  ✗ ${failed} TEST(S) FAILED\n`);
    process.exit(1);
  }
}

runTests();
