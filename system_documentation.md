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
- **`lastBillPrintLedgerOrder`** — Resolves same-millisecond ordering between bill and payments.
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

Let **`stmtUnpaid`** = **`getOutstandingLastStatementUnpaid`** (last statement total minus payments strictly **after** that bill).

Let **`priorChain`** = `stmtUnpaid` if it is positive, else **`pastDue`** (the rolled field).

**Total** is normally `currentDue + priorChain - credit`, **except** when all are true:

- Not in a **new calendar period** after the last bill print (`!isCalendarPeriodAfterLastBillPrint`),
- `stmtUnpaid` is material,
- **`currentDue`** already covers that unpaid statement (`currentDue + tolerance >= stmtUnpaid`).

Then **total** = `currentDue - credit` only, so the same principal is not added twice. This matters when the “current” view still embodies the last statement before roll-forward.

When **total** hits zero, **`lateFeeAnchorPrintDate`** may be cleared.

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

1. Captures **pre-roll** **`pastDueOnBill`** (max of field past due vs outstanding last statement).
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

1. Prefer **gross amounts from the latest `billingCharge` row** (sewer, tax, PUC, late on bill) over **`calc`** for the closed cycle, so a new month’s proration does not corrupt the rolled split.
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
  - **While “today” is still in the same calendar month as `lastBillPrintDate`:** **Past Due** and **due date** (and status from UI path) stay at frozen PDF values. **Late fee line** = **frozen PDF late** + **live** `calculateCustomerTotal(..., { billUiSnapshot: true }).lateFeeAmount` so a **second** 21-day accrual after the print still increases the line. **Total** = `frozenTotal - frozenLate + displayLate` so the total moves with that late accrual without double-counting the frozen late chunk.
  - **When the simulated calendar month is strictly after the bill print month** (`isCalendarPeriodAfterLastBillPrint`): **Total**, **Past Due**, and **Late Fee** switch to the **live** `billUiSnapshot` calculation so new current-cycle service (and rolled balances) match **`calculateCustomerTotal`** — the same basis **`maybeApplyDepositAt60Days`** uses. Otherwise the frozen total would ignore the new month’s sewer/tax/PUC while deposit still applied the full live amount.

Without a frozen snapshot, amounts come from **live** calc, with **Past Due** optionally overridden by **`lastBillPdfPastDueLine`** when set.

**`showCustomerPaymentInfo`** (payment module) uses **live** `calculateCustomerTotal` only — it does **not** use the frozen snapshot path.

---

## 8. Automatic late fee (21-day, per bill)

- **`getDaysSinceLastBillPrint`** — Calendar days since **`lastBillPrintDate`**.
- **`getLateFeeTimerDays()`** — From settings (commonly **21**).
- **`compute21DayLateFeeDollars`** — Returns fee only if: auto late enabled, days ≥ timer, **`getTotalDueExcludingAutoLateFee`** > 0, and not blocked by **grace amount** (if enabled).
- **`getTotalDueExcludingAutoLateFee`** — Current cycle due (with late passed into consistency helper) + **past due** − **credit**. Drives eligibility so you do not charge late when nothing is owed.
- **`getLateFeeBaseAmountBeforeFees`** — For percent/combination modes; includes **`getOutstandingLastStatementUnpaid`** when **`pastDue`** has not yet rolled that obligation.

**`getTotalOwedForLateTracking`** mirrors the same **no double-count** idea as **`calculateCustomerTotal`** when last statement is already embedded in **currentDue**.

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

**`maybeApplyDepositAt60Days`** runs inside **`calculateCustomerTotal`** (unless skipped). When continuous delinquency days exceed **`getDepositWithdrawDelinquencyDays()`**, deposit may be applied via **`applyCustomerPaymentByHierarchy`** with **`billUiSnapshot: true`** / **`skipDepositAutoApply`** orchestration so recursion and logging remain consistent. **`lastBill60DayDepositApplied`** prevents repeat application.

---

## 12. Diagnostics

- Filter browser console for **`[PastDueRoll]`** to trace roll-forward, composition splits, and ledger→statement adjustments.
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
5. **Advance to month after last bill without printing** — Panel **total** / **past due** / **late** match live calc so deposit auto-apply and Process Bill agree (no understated total vs full `amountPaid`).
6. **Past Due → View details** after multiple rolls — Sewer/tax/PUC scale with rolled cycles; **no** standalone **Past due amount** row when expand logic applies.
7. **Payment** — Hierarchy order changes allocation; past due payments shrink composition proportionally.

---

*Last aligned with application logic in `public/index.html` as of documentation authoring (April 2026).*
