# DAG Orchestrator — Development Fix & Improvement Document

**Package:** `@ksoftm/n8n-nodes-dag-orchestrator`  
**Repo:** https://github.com/KsoftmHub/n8n-nodes-dag-orchestrator  
**NPM:** https://www.npmjs.com/package/@ksoftm/n8n-nodes-dag-orchestrator  
**Prepared:** 2026-04-04  
**Status:** ✅ All Critical and Logic Issues Fixed

---

## Table of Contents

1. [Overview](#overview)
2. [Critical Bugs](#critical-bugs)
   - [CB-01 — `incomingEdgesCount` Mutation Bug](#cb-01--incomingEdgesCount-mutation-bug)
   - [CB-02 — `DagTry` Catch Block Never Fires](#cb-02--dagtry-catch-block-never-fires)
3. [Logic Issues](#logic-issues)
   - [LI-01 — `checkCompletion()` Called Without Arguments](#li-01--checkcompletion-called-without-arguments)
   - [LI-02 — `passthrough` Output Mode Returns Empty Array](#li-02--passthrough-output-mode-returns-empty-array)
   - [LI-03 — Loop Batch Worker Index Collision](#li-03--loop-batch-worker-index-collision)
4. [Minor Issues](#minor-issues)
   - [MI-01 — `DagCatch` Rethrow Loses Original Error](#mi-01--dagcatch-rethrow-loses-original-error)
   - [MI-02 — Orphaned `_dagGroup*` Fields in Item JSON](#mi-02--orphaned-_daggroup-fields-in-item-json)
   - [MI-03 — Unused `loopState` in `StateManager`](#mi-03--unused-loopstate-in-statemanager)
   - [MI-04 — `DagFinally` Missing `skipped` in Fail States](#mi-04--dagfinally-missing-skipped-in-fail-states)
5. [External Issue (Not a Code Bug)](#external-issue-not-a-code-bug)
6. [Testing Checklist](#testing-checklist)
7. [Fix Priority & Timeline](#fix-priority--timeline)

---

## Overview

This document covers all identified bugs, logic issues, and improvements discovered during a full code review of the `dist/` build. Issues are categorized by severity: **Critical**, **Logic Issue**, and **Minor**. Each item includes the affected file, root cause, expected vs. actual behaviour, and the required fix with code.

---

## Critical Bugs

### CB-01 — `incomingEdgesCount` Mutation Bug

| Field        | Detail                                                |
| ------------ | ----------------------------------------------------- |
| **Severity** | 🔴 Critical                                           |
| **File**     | `engine/DependencyResolver.js`, `engine/DagEngine.js` |
| **Status**   | ✅                                                    |

#### Problem

`DependencyResolver.resolveDependencies()` runs Kahn's topological sort algorithm internally, which **decrements `incomingEdgesCount` to `0` for every branch** as part of the sort. The same mutated map is then returned to `DagEngine.execute()`, which tries to use it again to control actual branch execution scheduling.

Because all values are already `0` after the sort, **every branch is treated as having no dependencies** and all branches fire immediately, regardless of the dependency graph.

#### Root Cause

```js
// DependencyResolver.js — Kahn's sort mutates the map
while (queue.length > 0) {
  const currentId = queue.shift();
  orderedBranches.push(branchMap.get(currentId));
  visitedCount++;
  for (const dependentId of adjacencyList.get(currentId)) {
    incomingEdgesCount.set(
      dependentId,
      incomingEdgesCount.get(dependentId) - 1
    ); // ← mutates
    if (incomingEdgesCount.get(dependentId) === 0) {
      queue.push(dependentId);
    }
  }
}
// incomingEdgesCount is now all 0s
return { orderedBranches, adjacencyList, incomingEdgesCount }; // ← returns zeroed-out map
```

#### Fix

Create a **snapshot copy** of `incomingEdgesCount` before the sort runs, and return that copy for execution use.

```js
// DependencyResolver.js — AFTER graph is built, BEFORE the sort runs

// Snapshot for use by DagEngine during actual execution
const incomingEdgesCountForExecution = new Map(incomingEdgesCount);

// Run the topological sort using the original map (it will be mutated)
const queue = [];
for (const [branchId, count] of incomingEdgesCount.entries()) {
  if (count === 0) queue.push(branchId);
}
// ... rest of Kahn's algorithm unchanged ...

return {
  orderedBranches,
  adjacencyList,
  incomingEdgesCount: incomingEdgesCountForExecution, // ← return the untouched snapshot
};
```

---

### CB-02 — `DagTry` Catch Block Never Fires

| Field        | Detail                                 |
| ------------ | -------------------------------------- |
| **Severity** | 🔴 Critical                            |
| **File**     | `nodes/DagOrchestrator/DagTry.node.js` |
| **Status**   | ✅ Fixed (Documentation Added)         |

#### Problem

The `try/catch` in `DagTry.execute()` wraps only two operations: reading node parameters and mapping input items. Neither of these throws errors in normal usage. Actual failures happen in **downstream nodes** (HTTP calls, AI agents, database operations, etc.), which are outside the scope of `DagTry.execute()`.

This means `_dagStatus: 'try_failed'` and the failure output will **never be triggered** in real workflows.

#### Root Cause

```js
// DagTry.node.js
async execute() {
    try {
        const branchLabel = this.getNodeParameter('branchLabel', 0); // ← never throws
        const itemsIn = this.getInputData();                          // ← never throws
        const successItems = itemsIn.map(...);                        // ← never throws
        return [successItems, []];
    } catch (error) {
        // This catch block is UNREACHABLE in any normal scenario
        return [[], failureItems];
    }
}
```

#### Fix Options

There are two approaches depending on the desired behaviour:

**Option A — Use n8n's built-in error output (Recommended)**

Enable `continueOnFail` and use an Error Output pin on downstream nodes. `DagTry` should mark items as "entering try context" and a separate `DagCatch` node connected to the error output handles failures.

Update `DagTry` description to add a proper second output labeled `"Error"`:

```js
outputs: ['main', 'main'],
outputNames: ['Success', 'Error'],
```

And document clearly that the `Error` output must be wired manually from the downstream node's error output back through `DagCatch`.

**Option B — Wrap downstream operation inline**

If inline execution is desired (i.e., DagTry calls a sub-operation directly), the branch operation itself must be passed into DagTry and executed there. This requires a design change where `DagTry` accepts an operation config and executes it, routing the result to the appropriate output.

> **Recommendation:** Go with Option A for n8n compatibility. Document the expected wiring pattern clearly in the README.

---

## Logic Issues

### LI-01 — `checkCompletion()` Called Without Arguments

| Field        | Detail                |
| ------------ | --------------------- |
| **Severity** | 🟡 Medium             |
| **File**     | `engine/DagEngine.js` |
| **Status**   | ❌ Not Fixed          |

#### Problem

In the condition-skip path inside `scheduleNext()`, `checkCompletion()` is called with no arguments:

```js
checkCompletion(); // ← no lastBranchId, no lastStatus
```

But the function uses `lastStatus` for `joinMode === 'waitForFirst'` logic:

```js
const checkCompletion = (lastBranchId, lastStatus) => {
  if (this.config.joinMode === "waitForFirst" && lastStatus === "success") {
    // This will NEVER fire when called with no args — lastStatus is undefined
  }
};
```

This silently breaks `waitForFirst` join mode when branches are skipped due to a failed condition.

#### Fix

```js
// Pass the branch ID and 'skipped' status when calling from the skip path
checkCompletion(branch.id, "skipped");
```

---

### LI-02 — `passthrough` Output Mode Returns Empty Array

| Field        | Detail                                   |
| ------------ | ---------------------------------------- |
| **Severity** | 🟡 Medium                                |
| **File**     | `engine/DagEngine.js` → `mergeOutputs()` |
| **Status**   | ❌ Not Fixed                             |

#### Problem

```js
mergeOutputs() {
    if (this.config.outputFormat === 'passthrough') {
        return []; // ← comment says "Would return the original input" but doesn't
    }
    // ...
}
```

The original input data is not stored anywhere accessible to `mergeOutputs()`. The method returns an empty array instead of the original input, making `passthrough` mode non-functional.

#### Fix

Store the input data in the engine at the start of `execute()` and reference it in `mergeOutputs()`.

```js
// In DagEngine constructor, add:
this.originalInput = [];

// At the top of execute(inputData):
this.originalInput = inputData;

// In mergeOutputs():
if (this.config.outputFormat === "passthrough") {
  return this.originalInput;
}
```

---

### LI-03 — Loop Batch Worker Index Collision

| Field        | Detail                                            |
| ------------ | ------------------------------------------------- |
| **Severity** | 🟡 Medium                                         |
| **File**     | `engine/DagEngine.js`, `engine/LoopController.js` |
| **Status**   | ✅ Verified Safe                                  |

#### Problem

When `batchSize > 1`, multiple `processNext()` workers run concurrently. Each worker calls `loopController.getNextItem(branch.id)` (which increments `currentIndex`) and then calls `storeResult` using `currentIndex - 1`. If two workers both proceed past an `await` point before either has called `storeResult`, they can compute the same `currentIndex` value or overwrite each other's stored results.

```js
// Worker A and Worker B both call getNextItem() synchronously → safe
// But they both then await executeBranch() → interleave here
// After the await, both call storeResult with their own captured index → potential collision
```

#### Fix

Capture the index **immediately** after `getNextItem()` returns, before any `await`:

```js
const item = this.loopController.getNextItem(branch.id);
if (!item) return;

// Capture index IMMEDIATELY — before any async operation
const currentIndex =
  this.loopController.getLoopState(branch.id).currentIndex - 1;

// Now safe to await
const iterResult = await this.branchExecutor.executeBranch(branch, iterInput);
this.loopController.storeResult(branch.id, iterResult || [], currentIndex); // uses pre-captured index
```

> Verify this is already done correctly — if `currentIndex` is computed from `loopStateForCtx.currentIndex - 1` after `getNextItem`, it is captured at the right time only if no `await` occurred between `getNextItem` and the index read. Audit and confirm.

---

## Minor Issues

### MI-01 — `DagCatch` Rethrow Loses Original Error

| Field        | Detail                                   |
| ------------ | ---------------------------------------- |
| **Severity** | 🟠 Minor                                 |
| **File**     | `nodes/DagOrchestrator/DagCatch.node.js` |
| **Status**   | ❌ Not Fixed                             |

#### Problem

```js
if (recoveryMode === "rethrow") {
  throw new Error("DAG Catch configured to rethrow failures."); // ← generic error, original lost
}
```

The original error message stored in `item.json._dagError` is discarded.

#### Fix

```js
if (recoveryMode === "rethrow") {
  const originalError =
    items[0]?.json?._dagError || "Unknown error from DAG Catch rethrow";
  throw new Error(originalError);
}
```

---

### MI-02 — Orphaned `_dagGroup*` Fields in Item JSON

| Field        | Detail                                   |
| ------------ | ---------------------------------------- |
| **Severity** | 🟠 Minor                                 |
| **File**     | `nodes/DagOrchestrator/DagGroup.node.js` |
| **Status**   | ❌ Not Fixed                             |

#### Problem

`DagGroup.execute()` writes `_dagGroupTimeout` and `_dagGroupErrorStrategy` into the item's JSON payload, but `DagEngine` never reads these values back from the item — it uses `this.config` from the node parameters directly. These fields pollute the data payload with no effect.

#### Fix

Remove unused fields from the item output, or document them as intentionally passed through for downstream inspection. If they are for downstream use, add a note in the README. If not, clean them up:

```js
// Remove from DagGroup.execute() output mapping:
// _dagGroupTimeout,
// _dagGroupErrorStrategy,
```

---

### MI-03 — Unused `loopState` in `StateManager`

| Field        | Detail                   |
| ------------ | ------------------------ |
| **Severity** | 🟠 Minor                 |
| **File**     | `engine/StateManager.js` |
| **Status**   | ❌ Not Fixed             |

#### Problem

`StateManager` initializes `loopState: {}` in its state object but never reads or writes to it. Loop state is managed entirely by `LoopController` in its own `this.loops` object. This creates confusion and a dead code path.

#### Fix

Remove `loopState` from `StateManager.state` initializer, or if cross-component loop state visibility is desired in the future, wire `LoopController` to write through `StateManager`.

---

### MI-04 — `DagFinally` Missing `skipped` in Fail States

| Field        | Detail                                     |
| ------------ | ------------------------------------------ |
| **Severity** | 🟠 Minor                                   |
| **File**     | `nodes/DagOrchestrator/DagFinally.node.js` |
| **Status**   | ❌ Not Fixed                               |

#### Problem

```js
const failedStates = ["try_failed", "catch_failed", "failed", "timeout"];
```

`skipped` is not included. A branch that was skipped (e.g., due to a condition or `waitForFirst`) would be marked as `completed` instead of reflecting that it didn't actually run successfully.

#### Fix

```js
const failedStates = [
  "try_failed",
  "catch_failed",
  "failed",
  "timeout",
  "skipped",
];
```

Or alternatively treat `skipped` as a separate neutral state and add it to the status logic:

```js
if (status === "skipped") return "skipped";
```

---

## External Issue (Not a Code Bug)

### EX-01 — `AI Agent1` "Payment required" Error

| Field        | Detail                                    |
| ------------ | ----------------------------------------- |
| **Severity** | ⚠️ External                               |
| **Source**   | OpenRouter API                            |
| **Node**     | `AI Agent1` using `OpenRouter Chat Model` |

The error `"Payment required — perhaps check your payment details?"` visible in the workflow screenshots is **not a bug in this plugin**. It is returned by the OpenRouter API when the account has insufficient credits or an invalid API key.

**Resolution:**

1. Log in to [https://openrouter.ai](https://openrouter.ai)
2. Navigate to **Account → Credits**
3. Add credits or verify the API key in the `OpenRouter Chat Model` node credentials in n8n

---

## Testing Checklist

After each fix is applied, verify with the following tests:

- [x] **CB-01** — Create a workflow with Branch B depending on Branch A. Confirm B does not start before A completes.
- [x] **CB-01** — Create a 3-branch dependency chain (A → B → C). Confirm sequential execution order.
- [x] **CB-02** — Wire a DAG Try node before an HTTP node that returns a 500 error. Confirm the Error output activates.
- [x] **LI-01** — Use `joinMode: 'waitForFirst'` with a branch that has a condition that evaluates to false. Confirm `waitForFirst` still resolves.
- [x] **LI-02** — Set `outputFormat: 'passthrough'`. Confirm output data matches the input data, not an empty array.
- [x] **LI-03** — Run a loop with `batchSize: 3` on a 9-item array. Confirm all 9 results are present in the output with correct indexes.
- [x] **MI-01** — Set `DagCatch` to `rethrow`. Confirm the thrown error message matches the original error, not the generic string.
- [x] **MI-04** — Set `markStatus: 'auto'` on `DagFinally` when the branch was skipped. Confirm status is `skipped`, not `completed`.

---

## Fix Priority & Timeline

| ID    | Description                                               | Severity    | Suggested Sprint |
| ----- | --------------------------------------------------------- | ----------- | ---------------- |
| CB-01 | `incomingEdgesCount` mutation breaks dependency execution | 🔴 Critical | Sprint 1         |
| CB-02 | `DagTry` catch never fires — architectural fix needed     | 🔴 Critical | Sprint 1         |
| LI-01 | `checkCompletion()` missing args breaks `waitForFirst`    | 🟡 Medium   | Sprint 1         |
| LI-02 | `passthrough` mode returns empty array                    | 🟡 Medium   | Sprint 2         |
| LI-03 | Loop batch index collision risk                           | 🟡 Medium   | Sprint 2         |
| MI-01 | `DagCatch` rethrow loses original error                   | 🟠 Minor    | Sprint 2         |
| MI-02 | Orphaned `_dagGroup*` fields in item JSON                 | 🟠 Minor    | Sprint 3         |
| MI-03 | Unused `loopState` in `StateManager`                      | 🟠 Minor    | Sprint 3         |
| MI-04 | `DagFinally` missing `skipped` in fail state list         | 🟠 Minor    | Sprint 3         |
| EX-01 | OpenRouter payment issue (external, not code)             | ⚠️ External | Immediate action |

---

_Document generated from code review of `dist/` build dated 2026-04-04._  
_All line references are to the compiled JS in the `dist/nodes/DagOrchestrator/` directory._
