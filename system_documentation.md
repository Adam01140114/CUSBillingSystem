# System documentation: billing, statements, and payments

This document is the **source of truth** for how the OnBase Terminal app models **charges**, **past due**, **automatic late fees**, **Produce Bill / Process Bill**, and **payment application**. It reflects the behavior implemented primarily in `public/index.html` (inline application logic). If behavior diverges from this document after a code change, either fix the code or update this file.

---

## 1. Goals and mental model

The system separates three ideas that appear on statements and the Process Bill panel:

| Concept | Meaning |
|--------|---------|
| **Past Due** | Rolled unpaid balance from **prior** billing cycles, plus any rolled **late fees** from those cycles. It is a **single number** on the customer (`pastDue`) with an optional **bucket breakdown** (`pastDueComposition`). |
| **Late Fee (line)** | The **current statement period’s** automatic late fee (21+ days after the **last bill print**, with balance still owed). It is **not** included in the Past Due dollar line when that line is aligned to the PDF. |
| **Total Amount Due** | What the customer still owes in total, computed from current-cycle charges (after payments), past due (net of credit), and the automatic late fee, with careful rules so nothing is double-counted. |

Payments apply to **categories** in a configurable **Payment Application Hierarchy**. Past due reductions update `pastDue` and shrink `pastDueComposition` proportionally.

---

## 2. Canonical data on the customer

Important fields (not exhaustive):

- **`pastDue`** — Net past-due balance. Can go negative to represent **credit** (credit is applied as `Math.abs(min(0, pastDueRaw))` in totals).
- **`pastDueComposition`** — Object whose keys are **canonical hierarchy labels** (see §5). Sums should match `pastDue` after `syncPastDueCompositionToPastDueField`.
- **`currentMonthPaid`**, **`currentMonthPaidSewer`**, **`currentMonthPaidTaxCodes`**, **`currentMonthPaidPuc`**, **`currentMonthPaidLateFee`** — How much of the **current** cycle has been paid, by bucket.
- **`lastBillPrintDate`** — ISO date of the **most recent** bill print. The **21-day late fee timer** always counts from this date and **restarts every time a bill is produced**.
- **`lateFeeAnchorPrintDate`** — Start of the **continuous 30–60–90 style** delinquency streak. It does **not** reset on rebill until the customer is paid to **$0** total due (see `calculateCustomerTotal` clearing the anchor when `total <= 0`).
- **`lastPrintedStatementTotalDue`** — Total that was due on the **last printed statement**, used with payment timestamps to compute **outstanding last statement** when `pastDue` has not yet caught up.
- **`lastBillPrintLedgerOrder`** — Persisted ledger order of the **last Produce Bill**; resolves same-millisecond ordering between bill and payments. Also used to find the **anchor** billing row (see §3.3), not merely the last `billingCharge` in `chargeHistory`.
- **`chargeHistory`** — Includes **`billingCharge`** rows (one per Produce Bill) and **`lateFeeAdded`** rows when a fee is logged. Billing rows store PDF-aligned amounts and often **`pastDueComposition`** snapshots.
- **`processBillPanelFrozenSnapshot`** — After Produce Bill, **Total / Past Due / Due date / status** can freeze to match the PDF while time moves forward; late fee line can still **accrue** additively (see §7).
- **`lastBillPdfPastDueLine`**, **`lastBillPdfLateFeeLine`** — PDF line snapshots for alignment between ledger and statement display.

---

## 3. Single calculation entry: `calculateCustomerTotal(customer, opts)`

Almost everything flows through **`calculateCustomerTotal`**.

### 3.1 Order of side effects inside the function

When **`opts.billUiSnapshot`** is not true:

1. **`maybeAppendLateFeeChargeHistory`** — May append a **`lateFeeAdded`** charge-history row when the 21-day rule first fires for the current `lastBillPrintDate`.
2. **`maybeApplyDepositAt60Days`** — May auto-apply security deposit when continuous delinquency days exceed the configured threshold (unless `skipDepositAutoApply`).

Then it computes:

- **Prorated sewer base** × **factor** → **`adjustedServiceCost`**
- **Tax codes** → **`totalSurcharge`**
- **`subtotalBeforePuc`** = sewer + tax
- **PUC** on subtotal → **`pucSurchargeAmount`**
- **`lateFeeAmount`** = **`getAutomaticLateFeeAmount`** (21-day rule; respects toggles and grace rules)
- **`currentDue`** = **`getCurrentCycleDueWithPaymentConsistency`** — remaining current cycle after payments, reconciling aggregate `currentMonthPaid` vs sum of bucket payments when they disagree.

### 3.2 Total due and double-counting guard

Let **`stmtUnpaid`** = **`getOutstandingLastStatementUnpaid`** (last statement total minus payments strictly **after** that bill — see §3.3 for how “after that bill” is anchored).

Let **`priorChain`** = `stmtUnpaid` if it is positive, else **`pastDue`** (the rolled field).

**Baseline total** is **`combined`** = `currentDue + priorChain - credit`.

**Problem:** After a bill and especially after **partial pay**, `stmtUnpaid` and **`currentDue`** (from **`getCurrentCycleDueWithPaymentConsistency`**) can describe the **same remaining dollars** two different ways. Adding **`priorChain`** (≈ `stmtUnpaid`) on top of **`currentDue`** then inflates the headline (e.g. ~\$108 + ~\$108 ≈ \$211) while the **Payments/Charges** running balance stays correct at a single net.

**Rolled collapse (inside `calculateCustomerTotal`):** Define

- **`rolled`** = `currentDue + pastDue - credit`,
- **`stmtNet`** = `stmtUnpaid - credit`,
- **`combined`** as above.

When **`stmtUnpaid`** is material, **`combined > rolled + 0.02`**, and **`rolled`** is within **`stmtMatchTol`** of **`stmtNet`**, use a **single-count** total instead of **`combined`**:

- **`stmtTolBase`** = `max(0.05, min(10, 0.02 × stmtNet))` (percentage floor on small balances),
- **`lateTol`** = rounded **`lateFeeAmount`** from the same calc pass (automatic 21-day fee),
- **`stmtMatchTol`** = `max(stmtTolBase, lateTol + 0.02)`.

So if the only gap between **`rolled`** and **`stmtNet`** is roughly the **current-period late fee** sitting in the statement total but not fully reflected the same way inside **`currentDue`**, the collapse still triggers (e.g. \$5 late: |\$103.49 − \$108.49| ≤ **`stmtMatchTol`**).

**Collapsed total** = **`max(rolled, stmtNet)`** (rounded), not **`rolled`** alone, so we never **under**-state vs the statement when **`stmtNet`** is slightly higher.

This collapse is **not** gated on “same calendar month as last bill print.” Advancing the **simulated date** into the next month **before** the next Produce Bill used to skip the guard and force **`combined`**; that caused the same double-count. The calendar check was removed for this branch only.

**`getTotalOwedForLateTracking`** — First keeps the legacy shortcut when **`!isCalendarPeriodAfterLastBillPrint`** and **`currentDue + tolerance ≥ stmtUnpaid`**. Separately, if the same **`rolled` / `stmtNet` / `combined`** duplicate pattern holds (using the same **`stmtMatchTol`** idea with the explicit late-fee argument), return **`max(rolledLt, stmtNetLt)`** instead of **`combinedLt`**, so delinquency days and late eligibility stay aligned with the headline total.

When **total** hits zero, **`lateFeeAnchorPrintDate`** may be cleared.

### 3.3 Statement credit anchor: latest bill row vs last print

**`getOutstandingLastStatementUnpaid`** and **`getSumPaymentAmountsAfterLastBillPrint`** depend on **`paymentCountsTowardStatementReduction`**, which must compare each payment to the **actual last printed bill**, not necessarily the **last** `source: 'billingCharge'` row in **`chargeHistory`**.

**Why:** Duplicate or out-of-order **“Billed Customer”** rows (same test DB, retries, or bugs) can leave a **spurious** billing row **after** a real payment in the array. **`getLatestBillingChargeHistoryRow`** would then treat the payment as **before** the “latest” bill, **`paidAfter`** drops to **\$0**, **`stmtUnpaid`** goes back to the **full** statement face, **`pastDueOnBill`** on the next bill can reconcile to **\$0**, and PDF/Process Bill math diverges from the ledger.

**`getAnchorBillingChargeHistoryRowForLastPrint(customer)`** picks the **`billingCharge`** row whose **`ledgerOrder`** matches **`customer.lastBillPrintLedgerOrder`** (and prefers **`timestamp`** matching **`lastBillPrintDate`** when present), then falls back to “latest” billing row.

**Uses:** `paymentCountsTowardStatementReduction`, **`getSumPaymentAmountsAfterLastBillPrint`** (logging anchor), **`getStatementPastDueCompositionForModal`**, **`addRolledUnpaidCurrentToPastDueComposition`**, **`buildBillRowPastDueCompositionSnapshot`**.

**`getPdfPreviousChargesReconciledToTotal`** — After nudging **`pdfPreviousCharges`** so `current_due + previous + late` matches **`calc.total`**, the reconciled previous-charges line is **floored** at **`max(ledger past due, outstanding last statement)`** so reconcile cannot wipe a known carried balance when line totals and **`calc.total`** disagree briefly.

---

## 4. Current cycle vs past due vs first bill

### 4.1 Current cycle

“Current cycle” charges are **sewer (adjusted service)**, **tax codes**, **PUC**, and **this period’s automatic late fee**. Payments reduce **`currentMonthPaid*`** fields.

### 4.2 Rolling forward after Produce Bill: `applyBillProductionRollForward`

After a successful bill PDF:

- **`unpaidCurrent`** = remaining current cycle (`calc.currentDue`), with a **Fresh start** guard: if the only reason current looks paid down is a synthetic **`testFreshStart`** payment, treat **`unpaidCurrent`** as the full **gross** cycle for roll purposes.
- **`lastPrintedStatementTotalDue`** is set from **`calc.total`**, possibly corrected upward if `unpaidCurrent + pastDue - credit` is higher (avoids understating what was on the statement).
- If **`rollUnpaidCurrentIntoPastDue`** is not false (i.e. **not** the first-ever bill for the account), **`addRolledUnpaidCurrentToPastDueComposition`** runs, then **`pastDue`** becomes **`prevPastDueRaw + unpaidCurrent`** (rolled balance).
- **Current-month payment buckets** and **`currentMonthPaymentHistory`** reset to zero for the new cycle.

**First bill:** When there was no prior **`lastBillPrintDate`**, the roll flag is false so **nothing** rolls into **`pastDue`** yet; past due only begins once a **later** bill closes while the customer still owed the prior period.

### 4.3 Billing row: `pushBillingCycleClosedLedgerRow`

When a bill is produced:

1. **`pastDueOnBill`** and PDF **previous charges** come from **`getPdfPreviousChargesReconciledToTotal`** (ledger past due vs outstanding last statement, then reconcile to **`calc.total`** with a **floor** — see §3.3 end). **`buildBillRowPastDueCompositionSnapshot`** uses the **anchor** prior bill row (§3.3).
2. Builds **`pastDueComposition`** for that row via **`buildBillRowPastDueCompositionSnapshot`** (mix of unpaid statement components vs tracked composition).
3. Calls **`applyBillProductionRollForward`**.
4. Pushes **`chargeHistory`** row with `source: 'billingCharge'`, line amounts, and optional **`pastDueComposition`**.
5. Updates **`lastBillPrintDate`**, sets **`lateFeeAnchorPrintDate`** if missing (rules tie anchor to prior print when opening past due mid-streak).

---

## 5. Payment Application Hierarchy

### 5.1 Default order

`PAYMENT_HIERARCHY_DEFAULT`:

`Late fees` → `Past due amount` → `Current amount due` → `Puc surcharge` → `Tax Codes`

Saved order lives in Firestore **`settings/paymentHierarchy`** and **`window.paymentHierarchyOrder`**. **`getHierarchyDisplayOrder()`** returns the normalized order used when applying payments.

### 5.2 Applying payments: `applyCustomerPaymentByHierarchy`

- Walks the hierarchy in order.
- For **`Past due amount`**, reduces **`pastDueRemaining`**, updates **`customer.pastDue`**, and calls **`subtractFromPastDueComposition`** (proportional shrink of all composition buckets).
- For other categories, increases the corresponding **`currentMonthPaid*`** fields.
- **`absorbRemainderInPastDue`** (default true): leftover dollars after the pass reduce **`pastDue`** again (used e.g. for deposit auto-apply).

**Display note:** In modals, **`Current amount due`** is labeled **“Sewer Charge”** via **`displayHierarchyLabelForModal`**.

### 5.3 `pastDueComposition` maintenance

- **`ensurePastDueComposition`** — Ensures all canonical keys exist.
- **`syncPastDueCompositionToPastDueField`** — Scales or stuffs drift into buckets so the **sum of buckets** matches **`pastDue`**. If there was no composition, legacy balance may land in **`Past due amount`** until rolls/payments refine it.

---

## 6. Past due composition on roll: `addRolledUnpaidCurrentToPastDueComposition`

When unpaid current rolls into **`pastDue`**:

1. Prefer **gross amounts from the anchor `billingCharge` row** (§3.3 — matches **`lastBillPrintLedgerOrder`**) over **`calc`** for the closed cycle, so a new month’s proration does not corrupt the rolled split.
2. Compute **remainders** after **`currentMonthPaid*`** on that closed cycle.
3. **`svcTake`** = min(unpaid current, sewer+tax+PUC remainder sum).
4. **`uMinusSvc`** = unpaid current minus what went to service.
5. **`lateAdd`** — Normally `min(lateRem, uMinusSvc)`. If the prior row has **`lateFeeAmount: 0`** but unpaid current still includes late (fee recognized after print), **`lateAdd`** = **`uMinusSvc`** so rolled late lands in **Late fees** composition.
6. Remaining service slice splits across **Current amount due** / **Tax Codes** / **Puc surcharge** by **sewerRem : taxRem : pucRem** weights.

This is why, after multiple unpaid cycles, **Past Due → View details** can show **doubled** sewer/tax/PUC lines plus **rolled late fees**, instead of one vague **“Past due amount”** line.

---

## 7. Process Bill panel: frozen snapshot vs live late fee

**`syncProcessBillPanelFrozenSnapshot`** stores **`amountDue`**, **`pastDue`**, **`lateFee`**, due date, and status badge from the **last PDF**.

**`getProcessBillPanelAmounts`**:

- If a frozen snapshot exists:
  - **Past Due** and **due date** (and status from UI path) stay at frozen PDF values until the next Produce Bill.
  - **Late fee line** = **frozen PDF late** + **live** `calculateCustomerTotal(..., { billUiSnapshot: true }).lateFeeAmount` so a second 21-day accrual after print still increases the line.
  - **Total** = `frozenTotal - frozenLate + displayLate`, so only post-print late accrual changes the frozen total.

Without a frozen snapshot, amounts come from **live** calc, with **Past Due** optionally overridden by **`lastBillPdfPastDueLine`** when set.

**`showCustomerPaymentInfo`** (payment module) uses **`getProcessBillPanelAmounts`** so **Total / Past Due / Late Fee / Due date / status badge** match the Process Bill statement (frozen snapshot + post-print late accrual), same as **`showCustomerBillInfo`**.

### 7.1 Payment module: `amountDue` on `paymentHistory` rows

When recording a payment from **Payment Processing** (`processPaymentFromModule`), **`amountDue`** (and check overpayment math that keys off it) must match the **same headline total** the cashier saw—**`getProcessBillPanelAmounts(customer).total`**, not necessarily raw **`calculateCustomerTotal(customer).total`**. Raw `calc.total` can diverge from the panel when `stmtUnpaid` / `priorChain` interacts with frozen PDF state; the panel is authoritative for POS. The **All Previous Payments / Charges** column **Balance After** uses `amountDue − amountPaid`, so a mismatched `amountDue` would show a wrong running balance even when customer balances were updated correctly.

**Register / tax breakdown:** When updating the current payment-processing register, any proportional split of tax vs PUC applied on that payment uses **`calcBeforePayment.totalSurcharge`** and **`calcBeforePayment.pucSurchargeAmount`** to derive the denominator (never an undefined `taxCodesTotal`).

### 7.2 Late-fee “View details” parity (Process Bill vs ledger)

- **Process Bill / Payment module** (live customer): **`buildProcessBillLateFeeDetailPack`** + **`getUiLateFeeDisplayRows`**, with footer text from **`buildLateFeeTimerHintForCustomer`** (per-bill days since print, 30–60–90 days, deposit threshold).
- **All Previous Payments / Charges** — **Payment** rows with a prior **`billingCharge`**: same row labels via **`getUiLateFeeDisplayRows(customer, statementLateFee, 0)`** where the statement late is the amount shown on that row; header line **`· Process Bill`** when enriched.
- **Charge** rows (`source: 'billingCharge'`): late-fee modal uses the **historical** **`lateFeeAmount` on that `chargeHistory` row** and **`ledgerLateFeeCycleLabelForBillingCharge`** (prior bill print date for “from billing cycle on …”), **not** a live **`buildProcessBillLateFeeDetailPack`** call (which would read `$0` late after the fee was paid down). Header **`· Process Bill`** and the same timer footer.

Process Bill and the payment module also expose **Late Fee → View Details** for the **live** customer; that path uses **`getUiLateFeeDisplayRows`** for split rows (e.g. prior-cycle late on the PDF plus a new 21-day accrual) plus the shared timer footer above.

---

## 8. Automatic late fee (21-day, per bill)

- **`getDaysSinceLastBillPrint`** — Calendar days since **`lastBillPrintDate`**.
- **`getLateFeeTimerDays()`** — From settings (commonly **21**).
- **`compute21DayLateFeeDollars`** — Returns fee only if: auto late enabled, days ≥ timer, **`getTotalDueExcludingAutoLateFee`** > 0, and not blocked by **grace amount** (if enabled).
- **`getTotalDueExcludingAutoLateFee`** — Current cycle due (with late passed into consistency helper) + **past due** − **credit**. Drives eligibility so you do not charge late when nothing is owed.
- **`getLateFeeBaseAmountBeforeFees`** — For percent/combination modes; includes **`getOutstandingLastStatementUnpaid`** when **`pastDue`** has not yet rolled that obligation.

**`getTotalOwedForLateTracking`** mirrors the **no double-count** rules in **`calculateCustomerTotal`** (see §3.2): same-calendar shortcut when **`currentDue`** already covers **`stmtUnpaid`**, plus the **`rolled` / `stmtNet` / `combined`** duplicate branch with **`stmtMatchTol`** (including late-fee width) returning **`max(rolledLt, stmtNetLt)`** when it fires.

**Charge history:** **`maybeAppendLateFeeChargeHistory`** logs **`lateFeeAdded`** tied to **`billPrintDate`** so each bill’s first crossing of the threshold is auditable.

---

## 9. Past Due “View details” composition (modal)

The Process Bill / PDF **Past Due line** is the dollar total shown next to **Past Due**. The modal explains it using **`pastDueComposition`** from the latest **`billingCharge`** row when possible.

- **`getStatementPastDueCompositionForModal`** compares snapshot sum (and row **`pastDueOnBill`**) to the **statement line** and to **ledger** `pastDue`.
- If the snapshot matches the **statement line**, it **normalizes** then **`expandPastDueAmountBucketIntoServiceForDisplay`**.
- If the snapshot matches **ledger** but the **statement line is lower** (because **current late fee** sits on the separate Late Fee line), **`adjustPastDueCompositionFromLedgerToStatementLine`** shaves the gap from **Late fees** then **sewer**, normalizes to the statement total, then **expands** any residual **`Past due amount`** bucket.

**`expandPastDueAmountBucketIntoServiceForDisplay`:** If undifferentiated **`Past due amount`** > 0, it redistributes that amount across **Current amount due** (sewer), **Tax Codes**, and **Puc surcharge** using the **same relative weights** as existing non-zero service buckets (or all to sewer if no weights). **Late fees** in composition stay separate. This keeps the modal aligned with the **Payment Application Hierarchy** categories and avoids a lazy single “past due lump” when the system can infer service mix.

User-facing copy clarifies: **rolled late fees stay inside the Past Due total**; the **Late Fee** line on Process Bill is **this period’s** automatic late fee only.

---

## 10. Due date and status

- **`getBillDueDateStr`** — Default: **last bill print date + grace calendar days** (grace often = late fee day − 1). Falls back to end of current month if no print date.
- **`getCustomerDaysLate`** — Uses **`getContinuousDelinquencyDays`** (anchor-based), not only “days since bill.”
- Status badge for Process Bill can be **frozen** with the snapshot when present.

---

## 11. Security deposit auto-apply

**`maybeApplyDepositAt60Days`** runs inside **`calculateCustomerTotal`** (unless skipped). When continuous delinquency days exceed **`getDepositWithdrawDelinquencyDays()`**, deposit may be applied via **`applyCustomerPaymentByHierarchy`** with **`billUiSnapshot: true`** / **`skipDepositAutoApply`** orchestration so recursion and logging remain consistent.

Deposit trigger amount basis:

- If no frozen Process Bill snapshot exists, deposit uses live `calculateCustomerTotal(..., { billUiSnapshot: true }).total`.
- If a frozen Process Bill snapshot exists, deposit uses the same displayed statement basis as Process Bill (`frozenTotal - frozenLate + (frozenLate + liveLate)`), i.e. frozen statement total plus post-print late accrual only.

This keeps auto-deposit `amountPaid` aligned with what the operator sees on Process Bill at trigger time. **`lastBill60DayDepositApplied`** prevents repeat application.

Ledger display alignment:

- Deposit auto-pay rows persist a late-fee detail snapshot (`lateFeeDetailsRows`) when available.
- In **All Previous Payments/Charges**, the **Late Fee** column has **Late Fee Details** and uses the saved snapshot for deposit rows so displayed line items match the statement total composition at trigger time.

### 11.1 Settings load order, test date, and deposit auto-apply

On app init, **`loadTogglesSettings()`** runs **before** **`loadCustomersFromFirestore()`** so the first **`updateCustomerTable` → `calculateCustomerTotal` → `maybeApplyDepositAt60Days`** pass sees the persisted **test date** and **`depositWithdrawDelinquencyDays`**, not real wall-clock time with in-memory defaults (which caused spurious deposit rows and wrong timestamps). Other reload paths (e.g. settings fallback customer load, delete customer, wipe billing data) also load toggles before customers where relevant.

**`updateSettingsDrawersTable`** reloads toggles via **`loadTogglesSettings()`** but must **not** assign **`testDate = null`** merely because the returned object omits `testDate`; that would clear a valid simulated date after a partial read.

### 11.2 Drawers after “Fresh start (reset all)”

**`test306090FreshStart`** may change the simulated calendar day. Drawer availability is keyed off **`lastCountDate`** matching **`getCurrentDate()`**. **`preserveDrawerSodAfterBillingFreshStart`** re-stamps **`lastCountDate`** to local noon on the **new** effective day for any drawer that **already** had an SOD count, so a billing-only fresh start does **not** force cashiers to redo **Start of day** for physical drawers. (Supervisor **EOD verify** still clears `lastCountDate` by design.)

---

### 11.3 Testing Drawer (Settings → System Toggles)

When **Testing Drawer** is enabled (`settings/toggles.testingDrawerEnabled`):

- **`syncSystemTestingDrawerFromToggle`** ensures a synthetic drawer **`Testing Drawer`** (reserved Firestore id) with **\$100** fund, **one \$100** SOD, **`lastCountDate`** stamped for the **effective** “today” (real or test date), and **available** for POS.
- When disabled, that drawer is removed from memory and Firestore.
- Runs after loading drawers, saving toggles, billing fresh start, opening the POS drawer modal, etc., so testers do not need supervisor **Start of Day** on a physical drawer.

### 11.4 Admin: Payments → Start New Payment without POS login

**`selectedDrawer`** is normally set when a **POS** user picks a drawer at login. **Admin** users opening **\$ Payments** and **Start New Payment** without a drawer used to get an alert.

**Behavior:** If **`!selectedDrawer`**, the app sets **`pendingStartNewPaymentAfterDrawer`**, opens **`showDrawerSelectionModal`** (same UI as POS: search + pick drawer). **`selectDrawer`** then clears the flag and **`await startNewPayment()`** again (skips the extra “You are now working with…” alert on that resume). **Cancel** appears while pending so the modal can be dismissed; **Close** appears on empty/unavailable-drawer dead ends so the flag is not left stuck.

---

## 12. Diagnostics

- **`[PastDueRoll]`** — Past-due roll, composition splits, ledger→statement adjustments. **Default console filter:** traces for customer name **Susan Young** only (substring match); set **`window.__BILL_PANEL_TRACE_ALL = true`** for all customers, **`window.__BILL_PANEL_TRACE = false`** to silence **`[BillPanelTrace]`** and **`[PastDueRoll]`**, or **`window.__BILL_PANEL_TRACE_CUSTOMER_ID`** to a fragment / id / account number.
- **`[BillPanelTrace]`** — Process Bill panel / **`getSumPaymentAmountsAfterLastBillPrint`** / frozen-vs-live branches (same gating as **`[PastDueRoll]`** by default).
- Filter browser console for **`[BillDiag]`** — requires **`window.__BILL_DIAG_LOGGING = true`** (opt-in billing totals).
- **`traceAutomaticLateFeeAmount`** / **`LATE_FEE_TRACE_ALL`** — Optional late-fee tracing.

---

## 13. Related files

- **`public/index.html`** — Primary implementation: totals, roll-forward, hierarchy, Process Bill UI, past due modal, deposit, charge history.
- **`public/script.js`** — Additional flows (e.g. search, batch import, some legacy payment simulation). If in doubt, **`index.html`** is the authority for the live POS-style paths described here.

---

## 14. Regression scenarios worth replaying

1. **First bill** — No past due until a **second** bill with unpaid first period.
2. **21 days after print** — Late fee appears; **Past Due** unchanged if everything was current except timing.
3. **Bill with unpaid prior** — Past Due line = rolled composition; Late Fee line = current period auto fee only.
4. **Second 21-day window without new bill (same month as print)** — Frozen panel **total** and **late** grow per **`getProcessBillPanelAmounts`** (frozen late + live late).
5. **Advance to month after last bill without printing** — Process Bill remains on frozen statement basis (plus post-print late accrual only), and deposit auto-apply uses that same basis so `amountPaid` matches visible Total Due.
6. **Past Due → View details** after multiple rolls — Sewer/tax/PUC scale with rolled cycles; **no** standalone **Past due amount** row when expand logic applies.
7. **Payment** — Hierarchy order changes allocation; past due payments shrink composition proportionally.
8. **Deposit trigger with stacked late fees** — If statement Late Fee is e.g. `$10.00` (rolled `$5` + new `$5`), deposit auto-pay row should show Late Fee `$10.00` and Late Fee Details split rows, while Amount Paid matches statement Total Due.
9. **Keyboard date advance (Ctrl/Cmd+Shift)** — Advances to next month using day-by-day simulation (overlay shown), not an instant jump.
10. **Partial pay after Produce Bill** — Payment panel **Total** matches ledger **Balance After** (no `currentDue + stmtUnpaid` inflation). Includes **advance to next calendar month** before the next bill: automatic **late fee** can make **`rolled`** and **`stmtNet`** differ by ~the late dollar amount; **`stmtMatchTol`** (§3.2) must still collapse so headline ≠ ~2× true balance (e.g. wrong **\$211** vs correct **\$108**).
11. **Second Produce Bill after partial pay + late** — Carried unpaid + new cycle charges: **Amount Breakdown** **Total Due**, **billingCharge** row columns, and **Balance After** should agree (e.g. carried **\$103.49** past due on the bill row + new cycle lines = one statement total such as **\$286.98** when that is the intended full statement).
12. **`billingCharge` row anchor** — Duplicate or trailing **Billed Customer** rows must not make **`getLatestBillingChargeHistoryRow`** “after” a real payment: **`getAnchorBillingChargeHistoryRowForLastPrint`** (§3.3) keeps **`stmtUnpaid`**, **`pastDueOnBill`**, and PDF previous-charges math aligned with the ledger.
13. **Admin → \$ Payments → Start New Payment** — With no drawer selected, drawer selection modal opens and **`startNewPayment`** resumes after **`selectDrawer`** (see §11.4).
14. **Ledger late fee on old billing row after pay** — **Late Fee Details** on the **Feb `billingCharge`** row still shows the **\$5** cycle line and **· Process Bill** + timer footer, not “current statement” \$0.
15. **Ledger late fee on check row** — Same **\$5 / prior cycle** copy as the bill row for the payment that applied to that statement.
16. **Payment `amountDue` on history row** — Matches **`getProcessBillPanelAmounts`** at pay time (aligned with Process Bill / payment header).

---

*Last aligned with application logic in `public/index.html` (May 2026).*
