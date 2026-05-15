# Expected success — Susan credit validation report (golden)

This document is the **target** shape for `validation_report_susan_credit.md` after the product matches deposit / balance / PDF-archive semantics. It is **not** auto-generated from the browser export.

**Principles encoded here**

1. **Security deposit (auto) on 03/02/2026** pays **$545.47** against **$545.47** owed for the statement being cleared → **Balance After must be `$0.00`**, not a recomputed “next-cycle” total in that same ledger row.
2. **`after_advance_2026-03-02` amount breakdown** must show **no open balance** (Total / Past due / Late fee **0**) at the instant the delinquent balance is cleared; later steps may accrue April dollars separately.
3. **April Produce Bill** must ship a PDF archive whose **`total_amount` matches the panel** (here **$351.98**), with full `fields` in the export (no omission block).
4. **`after_advance_2026-04-01` (first pass)** follows **`after_advance_2026-03-02`**: Amount breakdown stays **0 / 0 / 0** (no new balance until the April bill posts). The Payments/Charges table **must include** the **04/01/2026** POS check row (Give credit) on that same simulated date. The harness currently records two steps with the same `step` key for 04/01; this file labels them **first pass** vs **second pass** for clarity.

---

**Source file:** `test_output/test_script2_credit_susan_ledger_per_step.txt`
**Customer:** SUSAN YOUNG (CUS-3011000)

---

## 1 — Full Payments / Charges table (end of run)

| Date & Time | Type | Subtype | Sewer | Past Due | Tax Codes | PUC Surcharge | Late Fee | Credit | Amount Paid | Balance After |
|---|---|---|---|---|---|---|---|---|---|---|
| 01/01/2026 12:00 AM | Payment | Fresh start (full pay) | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $178.49 | $0.00 |
| 01/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $0.00 | $178.49 |
| 02/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $178.49 | $2.44 | $7.69 | $5.00 | $0.00 | $0.00 | $361.98 |
| 03/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $361.98 | $2.44 | $7.69 | $5.00 | $0.00 | $0.00 | $545.47 |
| 03/02/2026 12:00 AM | Payment | Security deposit (auto) | $168.36 | $361.98 | $2.44 | $7.69 | $5.00 | $0.00 | $545.47 | $0.00 |
| 04/01/2026 12:00 AM | Payment | Check | $168.36 | $361.98 | $2.44 | $7.69 | $5.00 | $0.00 | $10.00 | $-10.00 (credit) |
| 04/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $0.00 | $2.44 | $7.69 | $5.00 | $0.00 | $0.00 | $183.49 |
| 04/01/2026 12:00 AM | Payment | Check | $168.36 | $0.00 | $2.44 | $7.69 | $5.00 | $0.00 | $75.00 | $108.49 |
| 04/02/2026 12:00 AM | Payment | Security deposit (auto) | $103.49 | $98.49 | $0.00 | $0.00 | $0.00 | $0.00 | $201.98 | $108.49 |
| 05/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $75.00 | $2.44 | $7.69 | $5.00 | $0.00 | $0.00 | $258.49 |

---

## 2 — Each amount breakdown snapshot + Payments/Charges table **at that same step**

### `after_fresh_start` · simulated **2026-01-01**

| Field | Panel | RO | Frozen |
|---|---:|---:|---|
| Total | 0 | 0 | — |
| Past due | 0 | 0 | — |
| Late fee | 0 | 0 | — |
| dueDateStr (panel) | 01/31/2026 | — | — |
| fromFrozen | false | — | — |

**`ledgerPaymentsChargesTsv` (full table for this step)**

| Date & Time | Type | Subtype | Sewer | Past Due | Tax Codes | PUC Surcharge | Late Fee | Credit | Amount Paid | Balance After |
|---|---|---|---|---|---|---|---|---|---|---|
| 01/01/2026 12:00 AM | Payment | Fresh start (full pay) | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $178.49 | $0.00 |

### `after_bill_2026-01-01` · simulated **2026-01-01**

| Field | Panel | RO | Frozen |
|---|---:|---:|---|
| Total | 178.49 | 178.49 | 178.49 / 0 / 0 / 01/21/2026 / Current |
| Past due | 0 | 0 | — |
| Late fee | 0 | 0 | — |
| dueDateStr (panel) | 01/21/2026 | — | — |
| fromFrozen | true | — | — |
| lastBillPdfPastDueLine | — | — | 0 |
| lastBillPdfLateFeeLine | — | — | 0 |

**`ledgerPaymentsChargesTsv` (full table for this step)**

| Date & Time | Type | Subtype | Sewer | Past Due | Tax Codes | PUC Surcharge | Late Fee | Credit | Amount Paid | Balance After |
|---|---|---|---|---|---|---|---|---|---|---|
| 01/01/2026 12:00 AM | Payment | Fresh start (full pay) | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $178.49 | $0.00 |
| 01/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $0.00 | $178.49 |

### `after_advance_2026-02-01` · simulated **2026-02-01**

| Field | Panel | RO | Frozen |
|---|---:|---:|---|
| Total | 183.49 | 183.49 | 178.49 / 0 / 0 / 01/21/2026 / Current |
| Past due | 0 | 0 | — |
| Late fee | 5 | 5 | — |
| dueDateStr (panel) | 01/21/2026 | — | — |
| fromFrozen | true | — | — |
| lastBillPdfPastDueLine | — | — | 0 |
| lastBillPdfLateFeeLine | — | — | 0 |

**`ledgerPaymentsChargesTsv` (full table for this step)**

| Date & Time | Type | Subtype | Sewer | Past Due | Tax Codes | PUC Surcharge | Late Fee | Credit | Amount Paid | Balance After |
|---|---|---|---|---|---|---|---|---|---|---|
| 01/01/2026 12:00 AM | Payment | Fresh start (full pay) | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $178.49 | $0.00 |
| 01/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $0.00 | $178.49 |

### `after_bill_2026-02-01` · simulated **2026-02-01**

| Field | Panel | RO | Frozen |
|---|---:|---:|---|
| Total | 361.98 | 361.98 | 361.98 / 178.49 / 5 / 02/21/2026 / Overdue (31 days) |
| Past due | 178.49 | 178.49 | — |
| Late fee | 5 | 0 | — |
| dueDateStr (panel) | 02/21/2026 | — | — |
| fromFrozen | true | — | — |
| lastBillPdfPastDueLine | — | — | 178.49 |
| lastBillPdfLateFeeLine | — | — | 5 |

**`ledgerPaymentsChargesTsv` (full table for this step)**

| Date & Time | Type | Subtype | Sewer | Past Due | Tax Codes | PUC Surcharge | Late Fee | Credit | Amount Paid | Balance After |
|---|---|---|---|---|---|---|---|---|---|---|
| 01/01/2026 12:00 AM | Payment | Fresh start (full pay) | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $178.49 | $0.00 |
| 01/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $0.00 | $178.49 |
| 02/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $178.49 | $2.44 | $7.69 | $5.00 | $0.00 | $0.00 | $361.98 |

### `after_advance_2026-03-01` · simulated **2026-03-01**

| Field | Panel | RO | Frozen |
|---|---:|---:|---|
| Total | 366.98 | 366.98 | 361.98 / 178.49 / 5 / 02/21/2026 / Overdue (31 days) |
| Past due | 178.49 | 178.49 | — |
| Late fee | 10 | 5 | — |
| dueDateStr (panel) | 02/21/2026 | — | — |
| fromFrozen | true | — | — |
| lastBillPdfPastDueLine | — | — | 178.49 |
| lastBillPdfLateFeeLine | — | — | 5 |

**`ledgerPaymentsChargesTsv` (full table for this step)**

| Date & Time | Type | Subtype | Sewer | Past Due | Tax Codes | PUC Surcharge | Late Fee | Credit | Amount Paid | Balance After |
|---|---|---|---|---|---|---|---|---|---|---|
| 01/01/2026 12:00 AM | Payment | Fresh start (full pay) | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $178.49 | $0.00 |
| 01/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $0.00 | $178.49 |
| 02/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $178.49 | $2.44 | $7.69 | $5.00 | $0.00 | $0.00 | $361.98 |

### `after_bill_2026-03-01` · simulated **2026-03-01**

| Field | Panel | RO | Frozen |
|---|---:|---:|---|
| Total | 545.47 | 545.47 | 545.47 / 361.98 / 5 / 03/21/2026 / Overdue (59 days) |
| Past due | 361.98 | 361.98 | — |
| Late fee | 5 | 0 | — |
| dueDateStr (panel) | 03/21/2026 | — | — |
| fromFrozen | true | — | — |
| lastBillPdfPastDueLine | — | — | 361.98 |
| lastBillPdfLateFeeLine | — | — | 5 |

**`ledgerPaymentsChargesTsv` (full table for this step)**

| Date & Time | Type | Subtype | Sewer | Past Due | Tax Codes | PUC Surcharge | Late Fee | Credit | Amount Paid | Balance After |
|---|---|---|---|---|---|---|---|---|---|---|
| 01/01/2026 12:00 AM | Payment | Fresh start (full pay) | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $178.49 | $0.00 |
| 01/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $0.00 | $178.49 |
| 02/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $178.49 | $2.44 | $7.69 | $5.00 | $0.00 | $0.00 | $361.98 |
| 03/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $361.98 | $2.44 | $7.69 | $5.00 | $0.00 | $0.00 | $545.47 |

### `after_advance_2026-03-02` · simulated **2026-03-02**

| Field | Panel | RO | Frozen |
|---|---:|---:|---|
| Total | 0 | 0 | — |
| Past due | 0 | 0 | — |
| Late fee | 0 | 0 | — |
| dueDateStr (panel) | 03/21/2026 | — | — |
| fromFrozen | false | — | — |

**`ledgerPaymentsChargesTsv` (full table for this step)**

| Date & Time | Type | Subtype | Sewer | Past Due | Tax Codes | PUC Surcharge | Late Fee | Credit | Amount Paid | Balance After |
|---|---|---|---|---|---|---|---|---|---|---|
| 01/01/2026 12:00 AM | Payment | Fresh start (full pay) | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $178.49 | $0.00 |
| 01/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $0.00 | $178.49 |
| 02/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $178.49 | $2.44 | $7.69 | $5.00 | $0.00 | $0.00 | $361.98 |
| 03/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $361.98 | $2.44 | $7.69 | $5.00 | $0.00 | $0.00 | $545.47 |
| 03/02/2026 12:00 AM | Payment | Security deposit (auto) | $168.36 | $361.98 | $2.44 | $7.69 | $5.00 | $0.00 | $545.47 | $0.00 |

### `after_advance_2026-04-01` · simulated **2026-04-01** (first pass — calendar on 04/01, before April bill)

| Field | Panel | RO | Frozen |
|---|---:|---:|---|
| Total | 0 | 0 | — |
| Past due | 0 | 0 | — |
| Late fee | 0 | 0 | — |
| dueDateStr (panel) | 04/21/2026 | — | — |
| fromFrozen | false | — | — |

**`ledgerPaymentsChargesTsv` (full table for this step)**

| Date & Time | Type | Subtype | Sewer | Past Due | Tax Codes | PUC Surcharge | Late Fee | Credit | Amount Paid | Balance After |
|---|---|---|---|---|---|---|---|---|---|---|
| 01/01/2026 12:00 AM | Payment | Fresh start (full pay) | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $178.49 | $0.00 |
| 01/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $0.00 | $178.49 |
| 02/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $178.49 | $2.44 | $7.69 | $5.00 | $0.00 | $0.00 | $361.98 |
| 03/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $361.98 | $2.44 | $7.69 | $5.00 | $0.00 | $0.00 | $545.47 |
| 03/02/2026 12:00 AM | Payment | Security deposit (auto) | $168.36 | $361.98 | $2.44 | $7.69 | $5.00 | $0.00 | $545.47 | $0.00 |
| 04/01/2026 12:00 AM | Payment | Check | $168.36 | $361.98 | $2.44 | $7.69 | $5.00 | $0.00 | $10.00 | $-10.00 (credit) |

### `after_pre_april_credit_check` · simulated **2026-04-01**

| Field | Panel | RO | Frozen |
|---|---:|---:|---|
| Total | 173.49 | 173.49 | — |
| Past due | 0 | 0 | — |
| Late fee | 5 | 5 | — |
| dueDateStr (panel) | 03/21/2026 | — | — |
| fromFrozen | false | — | — |

**`ledgerPaymentsChargesTsv` (full table for this step)**

| Date & Time | Type | Subtype | Sewer | Past Due | Tax Codes | PUC Surcharge | Late Fee | Credit | Amount Paid | Balance After |
|---|---|---|---|---|---|---|---|---|---|---|
| 01/01/2026 12:00 AM | Payment | Fresh start (full pay) | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $178.49 | $0.00 |
| 01/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $0.00 | $178.49 |
| 02/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $178.49 | $2.44 | $7.69 | $5.00 | $0.00 | $0.00 | $361.98 |
| 03/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $361.98 | $2.44 | $7.69 | $5.00 | $0.00 | $0.00 | $545.47 |
| 03/02/2026 12:00 AM | Payment | Security deposit (auto) | $168.36 | $361.98 | $2.44 | $7.69 | $5.00 | $0.00 | $545.47 | $0.00 |
| 04/01/2026 12:00 AM | Payment | Check | $168.36 | $361.98 | $2.44 | $7.69 | $5.00 | $0.00 | $10.00 | $-10.00 (credit) |

### `after_advance_2026-04-01` · simulated **2026-04-01** (second pass — after pre-April credit check, before April Produce Bill)

| Field | Panel | RO | Frozen |
|---|---:|---:|---|
| Total | 173.49 | 173.49 | — |
| Past due | 0 | 0 | — |
| Late fee | 5 | 5 | — |
| dueDateStr (panel) | 03/21/2026 | — | — |
| fromFrozen | false | — | — |

**`ledgerPaymentsChargesTsv` (full table for this step)**

| Date & Time | Type | Subtype | Sewer | Past Due | Tax Codes | PUC Surcharge | Late Fee | Credit | Amount Paid | Balance After |
|---|---|---|---|---|---|---|---|---|---|---|
| 01/01/2026 12:00 AM | Payment | Fresh start (full pay) | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $178.49 | $0.00 |
| 01/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $0.00 | $178.49 |
| 02/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $178.49 | $2.44 | $7.69 | $5.00 | $0.00 | $0.00 | $361.98 |
| 03/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $361.98 | $2.44 | $7.69 | $5.00 | $0.00 | $0.00 | $545.47 |
| 03/02/2026 12:00 AM | Payment | Security deposit (auto) | $168.36 | $361.98 | $2.44 | $7.69 | $5.00 | $0.00 | $545.47 | $0.00 |
| 04/01/2026 12:00 AM | Payment | Check | $168.36 | $361.98 | $2.44 | $7.69 | $5.00 | $0.00 | $10.00 | $-10.00 (credit) |

### `after_bill_2026-04-01` · simulated **2026-04-01**

| Field | Panel | RO | Frozen |
|---|---:|---:|---|
| Total | 351.98 | 351.98 | 183.49 / 0 / 5 / 04/21/2026 / Overdue (90 days) |
| Past due | 0 | 173.49 | — |
| Late fee | 0 | 0 | — |
| dueDateStr (panel) | 04/21/2026 | — | — |
| fromFrozen | false | — | — |
| lastBillPdfPastDueLine | — | — | 0 |
| lastBillPdfLateFeeLine | — | — | 5 |

**`ledgerPaymentsChargesTsv` (full table for this step)**

| Date & Time | Type | Subtype | Sewer | Past Due | Tax Codes | PUC Surcharge | Late Fee | Credit | Amount Paid | Balance After |
|---|---|---|---|---|---|---|---|---|---|---|
| 01/01/2026 12:00 AM | Payment | Fresh start (full pay) | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $178.49 | $0.00 |
| 01/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $0.00 | $178.49 |
| 02/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $178.49 | $2.44 | $7.69 | $5.00 | $0.00 | $0.00 | $361.98 |
| 03/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $361.98 | $2.44 | $7.69 | $5.00 | $0.00 | $0.00 | $545.47 |
| 03/02/2026 12:00 AM | Payment | Security deposit (auto) | $168.36 | $361.98 | $2.44 | $7.69 | $5.00 | $0.00 | $545.47 | $0.00 |
| 04/01/2026 12:00 AM | Payment | Check | $168.36 | $361.98 | $2.44 | $7.69 | $5.00 | $0.00 | $10.00 | $-10.00 (credit) |
| 04/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $0.00 | $2.44 | $7.69 | $5.00 | $0.00 | $0.00 | $183.49 |

### `after_partial_check_75` · simulated **2026-04-01**

| Field | Panel | RO | Frozen |
|---|---:|---:|---|
| Total | 201.98 | 201.98 | — |
| Past due | 0 | 173.49 | — |
| Late fee | 0 | 0 | — |
| dueDateStr (panel) | 04/21/2026 | — | — |
| fromFrozen | false | — | — |

**`ledgerPaymentsChargesTsv` (full table for this step)**

| Date & Time | Type | Subtype | Sewer | Past Due | Tax Codes | PUC Surcharge | Late Fee | Credit | Amount Paid | Balance After |
|---|---|---|---|---|---|---|---|---|---|---|
| 01/01/2026 12:00 AM | Payment | Fresh start (full pay) | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $178.49 | $0.00 |
| 01/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $0.00 | $178.49 |
| 02/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $178.49 | $2.44 | $7.69 | $5.00 | $0.00 | $0.00 | $361.98 |
| 03/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $361.98 | $2.44 | $7.69 | $5.00 | $0.00 | $0.00 | $545.47 |
| 03/02/2026 12:00 AM | Payment | Security deposit (auto) | $168.36 | $361.98 | $2.44 | $7.69 | $5.00 | $0.00 | $545.47 | $0.00 |
| 04/01/2026 12:00 AM | Payment | Check | $168.36 | $361.98 | $2.44 | $7.69 | $5.00 | $0.00 | $10.00 | $-10.00 (credit) |
| 04/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $0.00 | $2.44 | $7.69 | $5.00 | $0.00 | $0.00 | $183.49 |
| 04/01/2026 12:00 AM | Payment | Check | $168.36 | $0.00 | $2.44 | $7.69 | $5.00 | $0.00 | $75.00 | $108.49 |

### `after_advance_2026-05-01` · simulated **2026-05-01**

| Field | Panel | RO | Frozen |
|---|---:|---:|---|
| Total | 108.49 | 108.49 | — |
| Past due | 0 | 75 | — |
| Late fee | 5 | 5 | — |
| dueDateStr (panel) | 04/21/2026 | — | — |
| fromFrozen | false | — | — |

**`ledgerPaymentsChargesTsv` (full table for this step)**

| Date & Time | Type | Subtype | Sewer | Past Due | Tax Codes | PUC Surcharge | Late Fee | Credit | Amount Paid | Balance After |
|---|---|---|---|---|---|---|---|---|---|---|
| 01/01/2026 12:00 AM | Payment | Fresh start (full pay) | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $178.49 | $0.00 |
| 01/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $0.00 | $178.49 |
| 02/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $178.49 | $2.44 | $7.69 | $5.00 | $0.00 | $0.00 | $361.98 |
| 03/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $361.98 | $2.44 | $7.69 | $5.00 | $0.00 | $0.00 | $545.47 |
| 03/02/2026 12:00 AM | Payment | Security deposit (auto) | $168.36 | $361.98 | $2.44 | $7.69 | $5.00 | $0.00 | $545.47 | $0.00 |
| 04/01/2026 12:00 AM | Payment | Check | $168.36 | $361.98 | $2.44 | $7.69 | $5.00 | $0.00 | $10.00 | $-10.00 (credit) |
| 04/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $0.00 | $2.44 | $7.69 | $5.00 | $0.00 | $0.00 | $183.49 |
| 04/01/2026 12:00 AM | Payment | Check | $168.36 | $0.00 | $2.44 | $7.69 | $5.00 | $0.00 | $75.00 | $108.49 |
| 04/02/2026 12:00 AM | Payment | Security deposit (auto) | $103.49 | $98.49 | $0.00 | $0.00 | $0.00 | $0.00 | $201.98 | $108.49 |

### `after_bill_2026-05-01` · simulated **2026-05-01**

| Field | Panel | RO | Frozen |
|---|---:|---:|---|
| Total | 258.49 | 258.49 | 258.49 / 75 / 5 / 05/21/2026 / Overdue (120 days) |
| Past due | 75 | 75 | — |
| Late fee | 5 | 0 | — |
| dueDateStr (panel) | 05/21/2026 | — | — |
| fromFrozen | true | — | — |
| lastBillPdfPastDueLine | — | — | 75 |
| lastBillPdfLateFeeLine | — | — | 5 |

**`ledgerPaymentsChargesTsv` (full table for this step)**

| Date & Time | Type | Subtype | Sewer | Past Due | Tax Codes | PUC Surcharge | Late Fee | Credit | Amount Paid | Balance After |
|---|---|---|---|---|---|---|---|---|---|---|
| 01/01/2026 12:00 AM | Payment | Fresh start (full pay) | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $178.49 | $0.00 |
| 01/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $0.00 | $178.49 |
| 02/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $178.49 | $2.44 | $7.69 | $5.00 | $0.00 | $0.00 | $361.98 |
| 03/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $361.98 | $2.44 | $7.69 | $5.00 | $0.00 | $0.00 | $545.47 |
| 03/02/2026 12:00 AM | Payment | Security deposit (auto) | $168.36 | $361.98 | $2.44 | $7.69 | $5.00 | $0.00 | $545.47 | $0.00 |
| 04/01/2026 12:00 AM | Payment | Check | $168.36 | $361.98 | $2.44 | $7.69 | $5.00 | $0.00 | $10.00 | $-10.00 (credit) |
| 04/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $0.00 | $2.44 | $7.69 | $5.00 | $0.00 | $0.00 | $183.49 |
| 04/01/2026 12:00 AM | Payment | Check | $168.36 | $0.00 | $2.44 | $7.69 | $5.00 | $0.00 | $75.00 | $108.49 |
| 04/02/2026 12:00 AM | Payment | Security deposit (auto) | $103.49 | $98.49 | $0.00 | $0.00 | $0.00 | $0.00 | $201.98 | $108.49 |
| 05/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $75.00 | $2.44 | $7.69 | $5.00 | $0.00 | $0.00 | $258.49 |

---

## 3 — PDF bill entries (full `fields` when present)

Each subsection is a Produce Bill snapshot with full `pdfBillArchive.fields` in the export (including **April** once the archive matches the panel). The **amount breakdown** and **ledger table** are taken from the **same** validation step object (`after_bill_…`).

### PDF bill **#1** — `print_date` **01/01/2026** · `total_amount` **$178.49**

| Summary | Value |
|---|---|
| print_date | 01/01/2026 |
| total_amount | $178.49 |
| current_due | $178.49 |
| previous_charges | $0.00 |
| late_fee | $0.00 |

**Full PDF `fields`:**

| PDF field | Value |
|---|---|
| account_address | 20240 ANZA DR |
| account_name | SUSAN YOUNG |
| account_no | CUS-3011000 |
| address_city_state_zip |  |
| current_due | $178.49 |
| cycle_period | 01/01/26 to 01/31/26 |
| days_in_cycle | 31 |
| deposit_explaination |  |
| deposit_explanation |  |
| due_date | 01/21/2026 |
| full_address | 20240 ANZA DR |
| late_fee | $0.00 |
| previous_charges | $0.00 |
| print_date | 01/01/2026 |
| sewer_charge | Sewer Charge |
| sewer_charge_amount | $168.36 |
| statement_date | 01/31/2026 |
| status | Status: Current |
| tax1 | BALANCING ACCT SURCH |
| tax10 |  |
| tax2 | PPEO |
| tax3 | PUC SCHG SW (4.50% x $170.80) |
| tax4 |  |
| tax5 |  |
| tax6 |  |
| tax7 |  |
| tax8 |  |
| tax9 |  |
| tax_charge1 | $1.23 |
| tax_charge10 |  |
| tax_charge2 | $1.21 |
| tax_charge3 | $7.69 |
| tax_charge4 |  |
| tax_charge5 |  |
| tax_charge6 |  |
| tax_charge7 |  |
| tax_charge8 |  |
| tax_charge9 |  |
| total_amount | $178.49 |

**Amount breakdown (`after_bill_2026-01-01` · 2026-01-01):**

| Field | Panel | RO | Frozen |
|---|---:|---:|---|
| Total | 178.49 | 178.49 | 178.49 / 0 / 0 / 01/21/2026 / Current |
| Past due | 0 | 0 | — |
| Late fee | 0 | 0 | — |
| dueDateStr (panel) | 01/21/2026 | — | — |
| fromFrozen | true | — | — |
| lastBillPdfPastDueLine | — | — | 0 |
| lastBillPdfLateFeeLine | — | — | 0 |

**Payments / Charges at this step:**

| Date & Time | Type | Subtype | Sewer | Past Due | Tax Codes | PUC Surcharge | Late Fee | Credit | Amount Paid | Balance After |
|---|---|---|---|---|---|---|---|---|---|---|
| 01/01/2026 12:00 AM | Payment | Fresh start (full pay) | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $178.49 | $0.00 |
| 01/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $0.00 | $178.49 |

### PDF bill **#2** — `print_date` **02/01/2026** · `total_amount` **$361.98**

| Summary | Value |
|---|---|
| print_date | 02/01/2026 |
| total_amount | $361.98 |
| current_due | $178.49 |
| previous_charges | $178.49 |
| late_fee | $5.00 |

**Full PDF `fields`:**

| PDF field | Value |
|---|---|
| account_address | 20240 ANZA DR |
| account_name | SUSAN YOUNG |
| account_no | CUS-3011000 |
| address_city_state_zip |  |
| current_due | $178.49 |
| cycle_period | 02/01/26 to 02/28/26 |
| days_in_cycle | 28 |
| deposit_explaination |  |
| deposit_explanation |  |
| due_date | 02/21/2026 |
| full_address | 20240 ANZA DR |
| late_fee | $5.00 |
| previous_charges | $178.49 |
| print_date | 02/01/2026 |
| sewer_charge | Sewer Charge |
| sewer_charge_amount | $168.36 |
| statement_date | 02/28/2026 |
| status | Status: 31 days late |
| tax1 | BALANCING ACCT SURCH |
| tax10 |  |
| tax2 | PPEO |
| tax3 | PUC SCHG SW (4.50% x $170.80) |
| tax4 |  |
| tax5 |  |
| tax6 |  |
| tax7 |  |
| tax8 |  |
| tax9 |  |
| tax_charge1 | $1.23 |
| tax_charge10 |  |
| tax_charge2 | $1.21 |
| tax_charge3 | $7.69 |
| tax_charge4 |  |
| tax_charge5 |  |
| tax_charge6 |  |
| tax_charge7 |  |
| tax_charge8 |  |
| tax_charge9 |  |
| total_amount | $361.98 |

**Amount breakdown (`after_bill_2026-02-01` · 2026-02-01):**

| Field | Panel | RO | Frozen |
|---|---:|---:|---|
| Total | 361.98 | 361.98 | 361.98 / 178.49 / 5 / 02/21/2026 / Overdue (31 days) |
| Past due | 178.49 | 178.49 | — |
| Late fee | 5 | 0 | — |
| dueDateStr (panel) | 02/21/2026 | — | — |
| fromFrozen | true | — | — |
| lastBillPdfPastDueLine | — | — | 178.49 |
| lastBillPdfLateFeeLine | — | — | 5 |

**Payments / Charges at this step:**

| Date & Time | Type | Subtype | Sewer | Past Due | Tax Codes | PUC Surcharge | Late Fee | Credit | Amount Paid | Balance After |
|---|---|---|---|---|---|---|---|---|---|---|
| 01/01/2026 12:00 AM | Payment | Fresh start (full pay) | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $178.49 | $0.00 |
| 01/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $0.00 | $178.49 |
| 02/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $178.49 | $2.44 | $7.69 | $5.00 | $0.00 | $0.00 | $361.98 |

### PDF bill **#3** — `print_date` **03/01/2026** · `total_amount` **$545.47**

| Summary | Value |
|---|---|
| print_date | 03/01/2026 |
| total_amount | $545.47 |
| current_due | $178.49 |
| previous_charges | $361.98 |
| late_fee | $5.00 |

**Full PDF `fields`:**

| PDF field | Value |
|---|---|
| account_address | 20240 ANZA DR |
| account_name | SUSAN YOUNG |
| account_no | CUS-3011000 |
| address_city_state_zip |  |
| current_due | $178.49 |
| cycle_period | 03/01/26 to 03/31/26 |
| days_in_cycle | 31 |
| deposit_explaination |  |
| deposit_explanation |  |
| due_date | 03/21/2026 |
| full_address | 20240 ANZA DR |
| late_fee | $5.00 |
| previous_charges | $361.98 |
| print_date | 03/01/2026 |
| sewer_charge | Sewer Charge |
| sewer_charge_amount | $168.36 |
| statement_date | 03/31/2026 |
| status | Status: 59 days late |
| tax1 | BALANCING ACCT SURCH |
| tax10 |  |
| tax2 | PPEO |
| tax3 | PUC SCHG SW (4.50% x $170.80) |
| tax4 |  |
| tax5 |  |
| tax6 |  |
| tax7 |  |
| tax8 |  |
| tax9 |  |
| tax_charge1 | $1.23 |
| tax_charge10 |  |
| tax_charge2 | $1.21 |
| tax_charge3 | $7.69 |
| tax_charge4 |  |
| tax_charge5 |  |
| tax_charge6 |  |
| tax_charge7 |  |
| tax_charge8 |  |
| tax_charge9 |  |
| total_amount | $545.47 |

**Amount breakdown (`after_bill_2026-03-01` · 2026-03-01):**

| Field | Panel | RO | Frozen |
|---|---:|---:|---|
| Total | 545.47 | 545.47 | 545.47 / 361.98 / 5 / 03/21/2026 / Overdue (59 days) |
| Past due | 361.98 | 361.98 | — |
| Late fee | 5 | 0 | — |
| dueDateStr (panel) | 03/21/2026 | — | — |
| fromFrozen | true | — | — |
| lastBillPdfPastDueLine | — | — | 361.98 |
| lastBillPdfLateFeeLine | — | — | 5 |

**Payments / Charges at this step:**

| Date & Time | Type | Subtype | Sewer | Past Due | Tax Codes | PUC Surcharge | Late Fee | Credit | Amount Paid | Balance After |
|---|---|---|---|---|---|---|---|---|---|---|
| 01/01/2026 12:00 AM | Payment | Fresh start (full pay) | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $178.49 | $0.00 |
| 01/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $0.00 | $178.49 |
| 02/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $178.49 | $2.44 | $7.69 | $5.00 | $0.00 | $0.00 | $361.98 |
| 03/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $361.98 | $2.44 | $7.69 | $5.00 | $0.00 | $0.00 | $545.47 |

### PDF bill **#4 (April)** — expected when archive matches panel (`after_bill_2026-04-01` · 2026-04-01)

| Summary | Expected value |
|---|---|
| print_date | 04/01/2026 |
| total_amount | **$351.98** (must equal Process Bill panel total at this step) |
| current_due | *(per statement split rules)* |
| previous_charges | *(per statement split rules)* |
| late_fee | *(per statement split rules)* |

**Contract:** `pdfBillArchive.fields` must be present in the export (same shape as other bills). The archived `total_amount` must match **panel 351.98** — no `omittedBecauseArchivedPdfDoesNotMatchPanel` entry for this step.

### PDF bill **#5** — `print_date` **05/01/2026** · `total_amount` **$258.49**

| Summary | Value |
|---|---|
| print_date | 05/01/2026 |
| total_amount | $258.49 |
| current_due | $178.49 |
| previous_charges | $75.00 |
| late_fee | $5.00 |

**Full PDF `fields`:**

| PDF field | Value |
|---|---|
| account_address | 20240 ANZA DR |
| account_name | SUSAN YOUNG |
| account_no | CUS-3011000 |
| address_city_state_zip |  |
| current_due | $178.49 |
| cycle_period | 05/01/26 to 05/31/26 |
| days_in_cycle | 31 |
| deposit_explaination | You were marked as 60+ days late on 04/02/2026 due to you not paying your bill since 01/01/2026. As a result, an amount of $201.98 was taken from your deposit and used to pay your amount due. |
| deposit_explanation | You were marked as 60+ days late on 04/02/2026 due to you not paying your bill since 01/01/2026. As a result, an amount of $201.98 was taken from your deposit and used to pay your amount due. |
| due_date | 05/21/2026 |
| full_address | 20240 ANZA DR |
| late_fee | $5.00 |
| previous_charges | $75.00 |
| print_date | 05/01/2026 |
| sewer_charge | Sewer Charge |
| sewer_charge_amount | $168.36 |
| statement_date | 05/31/2026 |
| status | Status: 120 days late |
| tax1 | BALANCING ACCT SURCH |
| tax10 |  |
| tax2 | PPEO |
| tax3 | PUC SCHG SW (4.50% x $170.80) |
| tax4 |  |
| tax5 |  |
| tax6 |  |
| tax7 |  |
| tax8 |  |
| tax9 |  |
| tax_charge1 | $1.23 |
| tax_charge10 |  |
| tax_charge2 | $1.21 |
| tax_charge3 | $7.69 |
| tax_charge4 |  |
| tax_charge5 |  |
| tax_charge6 |  |
| tax_charge7 |  |
| tax_charge8 |  |
| tax_charge9 |  |
| total_amount | $258.49 |

**Amount breakdown (`after_bill_2026-05-01` · 2026-05-01):**

| Field | Panel | RO | Frozen |
|---|---:|---:|---|
| Total | 258.49 | 258.49 | 258.49 / 75 / 5 / 05/21/2026 / Overdue (120 days) |
| Past due | 75 | 75 | — |
| Late fee | 5 | 0 | — |
| dueDateStr (panel) | 05/21/2026 | — | — |
| fromFrozen | true | — | — |
| lastBillPdfPastDueLine | — | — | 75 |
| lastBillPdfLateFeeLine | — | — | 5 |

**Payments / Charges at this step:**

| Date & Time | Type | Subtype | Sewer | Past Due | Tax Codes | PUC Surcharge | Late Fee | Credit | Amount Paid | Balance After |
|---|---|---|---|---|---|---|---|---|---|---|
| 01/01/2026 12:00 AM | Payment | Fresh start (full pay) | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $178.49 | $0.00 |
| 01/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $0.00 | $2.44 | $7.69 | $0.00 | $0.00 | $0.00 | $178.49 |
| 02/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $178.49 | $2.44 | $7.69 | $5.00 | $0.00 | $0.00 | $361.98 |
| 03/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $361.98 | $2.44 | $7.69 | $5.00 | $0.00 | $0.00 | $545.47 |
| 03/02/2026 12:00 AM | Payment | Security deposit (auto) | $168.36 | $361.98 | $2.44 | $7.69 | $5.00 | $0.00 | $545.47 | $0.00 |
| 04/01/2026 12:00 AM | Payment | Check | $168.36 | $361.98 | $2.44 | $7.69 | $5.00 | $0.00 | $10.00 | $-10.00 (credit) |
| 04/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $0.00 | $2.44 | $7.69 | $5.00 | $0.00 | $0.00 | $183.49 |
| 04/01/2026 12:00 AM | Payment | Check | $168.36 | $0.00 | $2.44 | $7.69 | $5.00 | $0.00 | $75.00 | $108.49 |
| 04/02/2026 12:00 AM | Payment | Security deposit (auto) | $103.49 | $98.49 | $0.00 | $0.00 | $0.00 | $0.00 | $201.98 | $108.49 |
| 05/01/2026 12:00 AM | Charge | Billed Customer | $168.36 | $75.00 | $2.44 | $7.69 | $5.00 | $0.00 | $0.00 | $258.49 |

