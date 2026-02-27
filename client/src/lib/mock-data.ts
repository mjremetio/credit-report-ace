export const mockReportData = {
  report_metadata: {
    bureau: "Consolidated (TU, EX, EQ)",
    generated_date: "2026-02-10",
    id: "REP-9982-FX",
    status: "analyzed"
  },
  consumer_identifiers: {
    names: ["DAVID N RENTERIA", "DAVID RENTERIA"],
    addresses: ["123 Main St, TX", "456 Oak Ln, TX"],
    dob_variations: ["11/14/1999", "1999 (Missing Month/Day)"],
    ssn_last4: "4921"
  },
  accounts: [
    {
      creditor: "SYNCB/CCDSTR",
      account_number_masked: "....1234",
      type: "Revolving",
      status: "Closed Chargeoff",
      balance: 723,
      dates: { dofd: "2020-08", last_payment: "2020-07" },
      source_pages: [3, 4]
    },
    {
      creditor: "CAPITAL ONE",
      account_number_masked: "....5521",
      type: "Revolving (Auth User)",
      status: "Open",
      balance: 53,
      dates: { dofd: null, last_payment: "2026-01" },
      source_pages: [5]
    },
    {
      creditor: "FST PREMIER",
      account_number_masked: "....8891",
      type: "Revolving",
      status: "Closed Derogatory",
      balance: 1450,
      dates: { dofd: "2022-08", last_payment: "2022-08" },
      source_pages: [6]
    }
  ],
  findings: [
    {
      id: "F-1001",
      finding_type: "Balance Error / Cross-Bureau Inconsistency",
      potential_fcra_theory: ["§1681e(b) - Failure to Follow Reasonable Procedures"],
      severity: "high",
      creditor: "SYNCB/CCDSTR",
      explanation: "Experian shows $0 high balance while TU/EQ show $723. Additionally, continuous Charge-Off reporting through Jan-26 without proper DOFD alignment suggests potential re-aging.",
      evidence: [
        { bureau: "Experian", quote: "Status: Collection/Chargeoff. High Balance: $0" },
        { bureau: "TransUnion", quote: "Status: Collection/Chargeoff. High Balance: $723" }
      ],
      matched_rule: "BALANCE_MISMATCH_CROSS_BUREAU"
    },
    {
      id: "F-1002",
      finding_type: "Status Conflict / Dispute Flag Missing",
      potential_fcra_theory: ["§1681s-2(b) - Failure to mark account as disputed"],
      severity: "critical",
      creditor: "FST PREMIER",
      explanation: "Equifax shows 'Account disputed' but Experian shows NOT disputed. A furnisher must report an account as disputed to all CRAs if a direct dispute was submitted.",
      evidence: [
        { bureau: "Equifax", quote: "Remarks: Account disputed by consumer" },
        { bureau: "Experian", quote: "Remarks: None" }
      ],
      matched_rule: "STATUS_DISPUTE_INCONSISTENCY"
    },
    {
      id: "F-1003",
      finding_type: "Identity / Mixed File Indicator",
      potential_fcra_theory: ["§1681e(b) - Accuracy/Integrity (Mixed File)"],
      severity: "medium",
      creditor: "Personal Info",
      explanation: "Incomplete DOB reporting on Experian (Missing Month/Day) alongside address history inconsistencies across bureaus. Potential indicator of a mixed file.",
      evidence: [
        { bureau: "Experian", quote: "DOB: 1999" },
        { bureau: "TransUnion", quote: "DOB: 11/14/1999" }
      ],
      matched_rule: "MIXED_FILE_NAME_ADDRESS_MISMATCH"
    },
    {
      id: "F-1004",
      finding_type: "Limit/Balance Inconsistency",
      potential_fcra_theory: ["§1681e(b) - Inaccurate Reporting"],
      severity: "low",
      creditor: "CAPITAL ONE",
      explanation: "Credit limit mismatch across bureaus ($1250 vs $750) and balance mismatch ($29 vs $53).",
      evidence: [
        { bureau: "Experian", quote: "Credit Limit: $750 | Balance: $53" },
        { bureau: "Equifax", quote: "Credit Limit: $1250 | Balance: $29" }
      ],
      matched_rule: "LIMIT_BALANCE_INCONSISTENCY"
    }
  ]
};