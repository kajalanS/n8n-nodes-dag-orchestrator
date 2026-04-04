# AGENTS.md — n8n-nodes-dag-orchestrator

## Complete Implementation Guide for AI Coding Assistants

> **Read every section of this file before writing any code.**
> This is the single source of truth. Do not make assumptions. Do not invent behaviour not described here.
> If something is not mentioned in this file, do not implement it.

---

## 1. WHAT THIS PROJECT IS

This is an n8n community node package that brings **Unreal Engine Blueprint-style visual workflow orchestration** to n8n. Instead of one node with a raw JSON config field, users connect small purpose-built nodes visually — exactly like connecting blueprint nodes in a graph.

The goal is that a non-programmer can open n8n, drop these nodes into a workflow, connect them with arrows, fill in simple dropdowns and text fields, and have a fully working parallel DAG workflow — without writing a single line of JSON or code.

**Core problems this solves for n8n users:**

- n8n cannot run parallel branches with dependency management natively
- Binary data is lost when passing through sub-workflows
- Nested loops break due to shared global run index
- Error handling requires many separate error workflow setups
- Loop index tracking requires manual hacks using $runIndex

---

## 2. THE ENGINE — DO NOT TOUCH THESE FILES

The following files are **complete, tested, and production-ready**. You must never modify, delete, refactor, or move them. They are the foundation that all new nodes build on top of.

```
nodes/DagOrchestrator/engine/DagEngine.ts
nodes/DagOrchestrator/engine/BranchExecutor.ts
nodes/DagOrchestrator/engine/StateManager.ts
nodes/DagOrchestrator/engine/DependencyResolver.ts
nodes/DagOrchestrator/engine/LoopController.ts
nodes/DagOrchestrator/types/Branch.types.ts
nodes/DagOrchestrator/types/Dag.types.ts
nodes/DagOrchestrator/types/State.types.ts
nodes/DagOrchestrator/engine/__tests__/
```

**What the engine already does (for your reference):**

- `DependencyResolver.ts` — Kahn's Algorithm topological sort, circular dependency detection
- `DagEngine.ts` — parallel execution via Promise.all, sequential mode, global timeout, join modes (waitForAll/waitForFirst/waitForAny), subgraph/group nesting via child DagEngine instances, condition evaluation (allSucceeded/anySucceeded/expression)
- `BranchExecutor.ts` — try/catch/finally per branch, retry with none/linear/exponential backoff, 4xx vs 5xx retry differentiation, per-branch timeout wrapping
- `StateManager.ts` — isolated execution state, binary buffer management (in-memory, no serialisation), branch results map, execution log, errors array
- `LoopController.ts` — loop index tracking, break/continue conditions, accumulated results, nested loop isolation via separate loop state per loop ID

---

## 3. DELETE THIS FILE

```
nodes/DagOrchestrator/DagOrchestrator.node.ts
```

This is the old single-node implementation. It exposed a raw `branchesConfig` JSON field to users which was too complex for non-programmers. It is being completely replaced by the seven-node system. Do not reuse any code from it.

---

## 4. UPDATE THESE FILES

### 4.1 package.json

Replace the existing `n8n.nodes` array entry with all seven new nodes:

```json
{
  "n8n": {
    "n8nNodesApiVersion": 1,
    "credentials": [],
    "nodes": [
      "dist/nodes/DagOrchestrator/DagSplit.node.js",
      "dist/nodes/DagOrchestrator/DagTry.node.js",
      "dist/nodes/DagOrchestrator/DagCatch.node.js",
      "dist/nodes/DagOrchestrator/DagFinally.node.js",
      "dist/nodes/DagOrchestrator/DagJoin.node.js",
      "dist/nodes/DagOrchestrator/DagLoop.node.js",
      "dist/nodes/DagOrchestrator/DagGroup.node.js"
    ]
  }
}
```

Also bump the version from `0.1.x` to `0.2.0` — this is a major UI change.

### 4.2 README.md

Fully rewrite the README. It must include:

- What the package does (one paragraph)
- Installation instructions (npm install via n8n community nodes UI)
- A table listing all seven nodes with one-line descriptions
- An ASCII flow diagram showing how nodes connect (use the image processing example from Section 10)
- A note that DagJoin and DagLoop require self-hosted n8n (they use `getWorkflowStaticData`)
- A note that verified community node publishing via GitHub Actions with provenance is required from May 1st 2026

### 4.3 tsconfig.json / tsconfig.build.json / jest.config.js

No changes needed.

---

## 5. CREATE THESE FILES

Create all seven files inside `nodes/DagOrchestrator/`. Full specifications follow in Sections 6-12.

```
nodes/DagOrchestrator/DagSplit.node.ts      <- Section 6
nodes/DagOrchestrator/DagTry.node.ts        <- Section 7
nodes/DagOrchestrator/DagCatch.node.ts      <- Section 8
nodes/DagOrchestrator/DagFinally.node.ts    <- Section 9
nodes/DagOrchestrator/DagJoin.node.ts       <- Section 10
nodes/DagOrchestrator/DagLoop.node.ts       <- Section 11
nodes/DagOrchestrator/DagGroup.node.ts      <- Section 12
```

---

## 6. DagSplit.node.ts — FULL SPECIFICATION

### Purpose

Takes one input and routes it to multiple parallel output branches simultaneously. Every DAG flow starts here. This node creates the unique execution context that all downstream nodes use to identify which DAG run they belong to.

### n8n Node Description

```typescript
displayName: "DAG Split";
name: "dagSplit";
group: ["transform"];
version: 1;
description: "Split workflow into parallel branches. Start of every DAG flow.";
inputs: ["main"];
outputs: ["main", "main", "main", "main", "main", "main"];
outputNames: [
  "Branch 1",
  "Branch 2",
  "Branch 3",
  "Branch 4",
  "Branch 5",
  "Branch 6",
];
icon: "file:icon.svg";
```

### Parameters

| Name              | Display Name        | Type    | Default | Description                                         |
| ----------------- | ------------------- | ------- | ------- | --------------------------------------------------- |
| branchCount       | Branch Count        | options | 2       | Number of parallel branches. Options: 2, 3, 4, 5, 6 |
| executionIdPrefix | Execution ID Prefix | string  | dag     | Short prefix for the unique execution ID            |

### Execute Logic — Step by Step

1. Get `branchCount` parameter (number 2-6)
2. Get `executionIdPrefix` parameter
3. Generate a unique execution ID: `${executionIdPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
4. Get all input items via `this.getInputData()`
5. For EACH branch index from 0 to branchCount-1, create a copy of all input items with dag context attached
6. For EACH item copy, merge the following fields into `item.json`:

```typescript
{
  _dagExecutionId: string,        // the unique ID generated in step 3
  _dagTotalBranches: number,      // branchCount
  _dagBranchIndex: number,        // 0-based index of this branch
  _dagBranchLabel: string,        // 'Branch 1', 'Branch 2' etc (1-based display)
  _dagStatus: 'running',
  _dagTimestamp: new Date().toISOString()
}
```

7. Also copy `item.binary` (if it exists) to the new item — binary data MUST be preserved
8. Return an array of arrays — pad with empty arrays for branches above branchCount up to maximum of 6
9. Example return for branchCount=3: `[items_b1, items_b2, items_b3, [], [], []]`

### Important Rules

- ALL branches receive ALL input items — branches are duplicated not split
- Binary data on items MUST be copied to every branch
- Unused output pins above branchCount must return empty arrays not cause errors
- The `_dagExecutionId` must be identical across all branches for the same execution

---

## 7. DagTry.node.ts — FULL SPECIFICATION

### Purpose

Marks the start of a try block on a branch. Attaches the branch label to items. Evaluates an optional run condition — if false, items are skipped. Passes items to the Success output. Routes to Failure output if this node errors or condition is false. Attaches retry and timeout config to item context for downstream use.

### n8n Node Description

```typescript
displayName: "DAG Try";
name: "dagTry";
group: ["transform"];
version: 1;
description: "Start a try block on a DAG branch. Routes to Success or Failure output.";
inputs: ["main"];
outputs: ["main", "main"];
outputNames: ["Success", "Failure"];
icon: "file:icon.svg";
```

### Parameters

| Name             | Display Name               | Type    | Default      | Description                                                                                          |
| ---------------- | -------------------------- | ------- | ------------ | ---------------------------------------------------------------------------------------------------- |
| branchLabel      | Branch Label               | string  | branch_1     | Unique ID for this branch. Must be unique in the DAG flow. DagJoin uses this to group results.       |
| operationLabel   | Operation Label            | string  | My Operation | Human-readable name for logs                                                                         |
| runCondition     | Run Condition              | string  | (empty)      | n8n expression. If not empty, branch only runs if this evaluates to true. Leave empty to always run. |
| timeoutMs        | Timeout (ms)               | number  | 0            | 0 means no timeout. Attached to context for reference.                                               |
| skipOnTimeout    | Skip Downstream on Timeout | boolean | false        | If true and timeout occurs, downstream dependent branches get fallback data instead of failing.      |
| fallbackData     | Fallback Data on Timeout   | json    | {}           | The fallback JSON passed downstream when skipOnTimeout is true.                                      |
| maxRetryAttempts | Max Retry Attempts         | number  | 1            | 1 means no retry.                                                                                    |
| retryDelayMs     | Retry Delay (ms)           | number  | 1000         | Milliseconds between retries.                                                                        |
| retryBackoff     | Retry Backoff              | options | none         | none / linear / exponential                                                                          |
| retryOn4xx       | Retry on 4xx Errors        | boolean | false        | Whether to retry on 4xx HTTP errors.                                                                 |
| retryOn5xx       | Retry on 5xx Errors        | boolean | true         | Whether to retry on 5xx HTTP errors.                                                                 |

### Execute Logic — Step by Step

1. Get all input items and all parameters
2. For each item:
   a. Check `runCondition` — if not empty evaluate it. If result is falsy: set `_dagStatus: 'skipped'` and route to output 1 (Failure). Stop processing this item.
   b. Merge the following into `item.json`:
   ```typescript
   {
     _dagBranchLabel: branchLabel,
     _dagOperationLabel: operationLabel,
     _dagStatus: 'try_running',
     _dagTimeoutMs: timeoutMs,
     _dagSkipOnTimeout: skipOnTimeout,
     _dagFallbackData: fallbackData,
     _dagMaxRetry: maxRetryAttempts,
     _dagRetryDelayMs: retryDelayMs,
     _dagRetryBackoff: retryBackoff,
     _dagRetryOn4xx: retryOn4xx,
     _dagRetryOn5xx: retryOn5xx,
     _dagTimestamp: new Date().toISOString()
   }
   ```
   c. Copy `item.binary` to the output item
   d. Route to output 0 (Success)
3. If this node itself throws an error: catch it, set `_dagStatus: 'try_failed'` and `_dagError: error.message` on items, route to output 1 (Failure)
4. Return `[successItems, failureItems]`

### Important Rules

- DagTry does NOT execute user logic — user operations happen in regular n8n nodes placed AFTER DagTry on the Success path
- Binary data must be copied through at every step

---

## 8. DagCatch.node.ts — FULL SPECIFICATION

### Purpose

Handles the failure path from DagTry. Receives failed or skipped items. Allows recovery. Marks items as recovered or permanently failed.

### n8n Node Description

```typescript
displayName: "DAG Catch";
name: "dagCatch";
group: ["transform"];
version: 1;
description: "Handle errors from a DAG Try block. Connect to the Failure output of DAG Try.";
inputs: ["main"];
outputs: ["main"];
outputNames: ["Recovered"];
icon: "file:icon.svg";
```

### Parameters

| Name         | Display Name  | Type    | Default  | Description                                                                   |
| ------------ | ------------- | ------- | -------- | ----------------------------------------------------------------------------- |
| branchLabel  | Branch Label  | string  | branch_1 | Must match the Branch Label of the corresponding DAG Try node.                |
| recoveryMode | Recovery Mode | options | fallback | fallback: use fallback data and continue; rethrow: mark as permanently failed |
| fallbackData | Fallback Data | json    | {}       | JSON to inject into items when recoveryMode is fallback.                      |
| logError     | Log Error     | boolean | true     | If true, keeps \_dagError on output item. If false, removes it.               |

### Execute Logic — Step by Step

1. Get all input items
2. For each item:
   a. If `recoveryMode` is `fallback`: merge `fallbackData` into `item.json`, set `_dagStatus: 'catch_recovered'`, set `_dagCatchRan: true`, remove `_dagError` if `logError` is false
   b. If `recoveryMode` is `rethrow`: set `_dagStatus: 'catch_failed'`, set `_dagCatchRan: true`, throw error with original `_dagError` message
   c. Copy `item.binary` to output item
3. Return recovered items to output 0

---

## 9. DagFinally.node.ts — FULL SPECIFICATION

### Purpose

Always runs at the end of a branch. Collection point before DagJoin. Marks items with final status. Ensures binary data is still attached.

### n8n Node Description

```typescript
displayName: "DAG Finally";
name: "dagFinally";
group: ["transform"];
version: 1;
description: "Always runs at the end of a DAG branch. Connect before DAG Join.";
inputs: ["main"];
outputs: ["main"];
outputNames: ["Output"];
icon: "file:icon.svg";
```

### Parameters

| Name        | Display Name | Type    | Default  | Description                                                                   |
| ----------- | ------------ | ------- | -------- | ----------------------------------------------------------------------------- |
| branchLabel | Branch Label | string  | branch_1 | Must exactly match the Branch Label in the corresponding DAG Try node.        |
| markStatus  | Final Status | options | auto     | auto: detect from \_dagStatus; success: force completed; failed: force failed |
| cleanupNote | Cleanup Note | string  | (empty)  | Optional note added to \_dagCleanupNote for logging.                          |

### Execute Logic — Step by Step

1. Get all input items
2. For each item:
   a. Determine final status:
   - `auto`: if `_dagStatus` is `try_running` or `catch_recovered` set `completed`. If `try_failed` or `catch_failed` set `failed`. If `skipped` keep `skipped`.
   - `success`: set `_dagStatus: 'completed'`
   - `failed`: set `_dagStatus: 'failed'`
     b. Set `_dagFinallyRan: true`
     c. Set `_dagBranchLabel` to branchLabel parameter (ensures correct label even if DagTry was bypassed)
     d. If `cleanupNote` not empty: set `_dagCleanupNote: cleanupNote`
     e. Set `_dagFinalTimestamp: new Date().toISOString()`
     f. Copy `item.binary` to output item
3. Return all items to output 0

### Important Rules

- DagFinally MUST be the last node on each branch before DagJoin
- Both success path and catch path of a branch must reach the SAME DagFinally node with matching branchLabel
- Binary data must be copied through

---

## 10. DagJoin.node.ts — FULL SPECIFICATION

### Purpose

Collects results from all branches and merges them. Waits for all expected branches using static data to accumulate state across separate n8n execution calls. Most complex node in the package.

### n8n Node Description

```typescript
displayName: "DAG Join";
name: "dagJoin";
group: ["transform"];
version: 1;
description: "Collect and merge results from all DAG branches. Place after all DAG Finally nodes.";
inputs: ["main"];
outputs: ["main"];
outputNames: ["Merged Output"];
icon: "file:icon.svg";
```

### Parameters

| Name                | Display Name          | Type    | Default         | Description                                            |
| ------------------- | --------------------- | ------- | --------------- | ------------------------------------------------------ |
| expectedBranchCount | Expected Branch Count | number  | 2               | Must match the Branch Count set in DAG Split           |
| joinMode            | Join Mode             | options | waitForAll      | waitForAll / waitForFirst / waitForAny                 |
| outputFormat        | Output Format         | options | merged          | merged / array / passthrough                           |
| errorStrategy       | Error Strategy        | options | continueOnError | stopOnFirst / continueOnError / collectErrors          |
| globalTimeoutMs     | Global Timeout (ms)   | number  | 60000           | How long to wait for all branches. 0 means no timeout. |

### Execute Logic — Step by Step

1. Get all input items. Each has `_dagExecutionId` and `_dagBranchLabel` on json.
2. Get node static data: `const staticData = this.getWorkflowStaticData('node')`
3. For each item:
   a. Read `executionId = item.json._dagExecutionId`
   b. Read `branchLabel = item.json._dagBranchLabel`
   c. Initialise `staticData[executionId]` if it does not exist:
   ```typescript
   staticData[executionId] = {
     branches: {},
     arrivedCount: 0,
     startedAt: Date.now(),
   };
   ```
   d. If `staticData[executionId].branches[branchLabel]` does not yet exist, increment `arrivedCount`
   e. Store the branch result:
   ```typescript
   staticData[executionId].branches[branchLabel] = {
     status: item.json._dagStatus,
     data: item.json,
     binary: item.binary || null,
     error: item.json._dagError || null,
     finalTimestamp: item.json._dagFinalTimestamp,
   };
   ```
4. Check timeout: if `globalTimeoutMs > 0` and `Date.now() - staticData[executionId].startedAt > globalTimeoutMs` mark `timedOut = true`
5. Check join condition:
   - `waitForAll`: emit if `arrivedCount >= expectedBranchCount` OR timedOut
   - `waitForFirst`: emit if `arrivedCount >= 1`
   - `waitForAny`: emit if any branch has status `completed` or `failed`
6. If join condition not met: return `[]` — do NOT throw an error
7. If join condition met, build merged output:

```typescript
const mergedOutput = {
  _dagExecutionId: executionId,
  _dagJoinMode: joinMode,
  _dagCompletedAt: new Date().toISOString(),
  _dagTimedOut: timedOut || false,
  branches: staticData[executionId].branches,
};
```

8. Apply `errorStrategy`:
   - `stopOnFirst`: if any branch has status `failed`, throw error with that branch's error message
   - `continueOnError`: include all branches including failed in output
   - `collectErrors`: add `errors: []` array listing all failed branches to mergedOutput
9. Apply `outputFormat`:
   - `merged`: return `[{ json: mergedOutput, binary: collectedBinaryFromAllBranches }]`
   - `array`: return one item per branch
   - `passthrough`: return items from first completed branch only
10. Delete `staticData[executionId]` after emitting to free memory
11. Return output items

### Binary Data in Merged Output

When outputFormat is `merged`, collect all binary data from all branches into one binary object keyed by branchLabel:

```typescript
binary: {
  image_storage_file: { ...binaryFromBranch1 },
  metadata_file: { ...binaryFromBranch2 }
}
```

### Important Rules

- Uses `getWorkflowStaticData('node')` — self-hosted n8n only. Document this clearly.
- When join condition is not met return `[]` not an error
- Always clean up staticData after emitting
- `expectedBranchCount` MUST match `branchCount` in DagSplit or results never emit

---

## 11. DagLoop.node.ts — FULL SPECIFICATION

### Purpose

Loops over an array with built-in index tracking. Fixes n8n nested loop bug by using isolated static data per loop. No sub-workflows needed. Routes current batch to Loop Body output. Routes completion summary to Done output.

### n8n Node Description

```typescript
displayName: "DAG Loop";
name: "dagLoop";
group: ["transform"];
version: 1;
description: "Loop over items with automatic index tracking. No sub-workflows needed.";
inputs: ["main"];
outputs: ["main", "main"];
outputNames: ["Loop Body", "Done"];
icon: "file:icon.svg";
```

### Parameters

| Name              | Display Name        | Type   | Default      | Description                                                               |
| ----------------- | ------------------- | ------ | ------------ | ------------------------------------------------------------------------- |
| sourceField       | Source Field        | string | items        | Field in item.json that contains the array to loop over                   |
| batchSize         | Batch Size          | number | 1            | Items per iteration sent to Loop Body                                     |
| maxIterations     | Max Iterations      | number | 1000         | Hard limit to prevent infinite loops                                      |
| indexVarName      | Index Variable Name | string | currentIndex | Name of index field added to each Loop Body item                          |
| totalVarName      | Total Variable Name | string | totalItems   | Name of total count field added to each Loop Body item                    |
| breakCondition    | Break Condition     | string | (empty)      | n8n expression evaluated after each iteration. Loop stops if true.        |
| continueCondition | Continue Condition  | string | (empty)      | n8n expression evaluated before each iteration. Skips iteration if false. |

### Execute Logic — Step by Step

1. Get static data: `const staticData = this.getWorkflowStaticData('node')`
2. Get all input items
3. Generate loop ID from `_dagExecutionId` if present, otherwise from a hash of sourceField + timestamp
4. If `staticData[loopId]` does not exist (first call):
   a. Read source array from `inputItems[0].json[sourceField]`
   b. If not an array or empty: route to output 1 (Done) with empty summary immediately
   c. Initialise:
   ```typescript
   staticData[loopId] = {
     items: sourceArray,
     currentIndex: 0,
     totalItems: sourceArray.length,
     brokeEarly: false,
     iterationCount: 0,
     originalItem: inputItems[0].json,
     originalBinary: inputItems[0].binary || {},
   };
   ```
5. Check if loop is complete: `currentIndex >= totalItems` OR `iterationCount >= maxIterations`
   - If complete: emit Done (step 9), clean up, return
6. Evaluate `continueCondition` if not empty. If false: increment `currentIndex`, return `[[], []]` — n8n will call again
7. Get next batch: `items.slice(currentIndex, currentIndex + batchSize)`
8. For each item in batch, create output item:

```typescript
{
  json: {
    ...staticData[loopId].originalItem,
    [indexVarName]: currentIndex,
    [totalVarName]: totalItems,
    isFirstItem: currentIndex === 0,
    isLastItem: currentIndex + batchSize >= totalItems,
    _dagLoopId: loopId,
    value: batchItem
  },
  binary: staticData[loopId].originalBinary
}
```

9. Update static data: `currentIndex += batchSize`, `iterationCount += 1`
10. Evaluate `breakCondition` if not empty. If true: set `brokeEarly: true`, mark loop complete
11. Route batch to output 0 (Loop Body). Return `[loopBodyItems, []]`
12. When complete, emit Done to output 1:

```typescript
{ json: {
    _dagLoopComplete: true,
    _dagLoopId: loopId,
    totalIterations: iterationCount,
    itemsProcessed: currentIndex,
    totalItems: totalItems,
    brokeEarly: brokeEarly,
    sourceField: sourceField
} }
```

13. Clean up `staticData[loopId]`. Return `[[], [doneItem]]`

---

## 12. DagGroup.node.ts — FULL SPECIFICATION

### Purpose

Groups a set of branches into a named, collapsible logical container representing a subgraph. Acts as a lightweight pass-through that tags items with a group label. Eliminates the need for sub-workflows for grouped operations. Can be nested inside other groups or DAG flows.

### n8n Node Description

```typescript
displayName: "DAG Group";
name: "dagGroup";
group: ["transform"];
version: 1;
description: "Group branches into a named subgraph. Place a DAG Split after this node to start the inner DAG.";
inputs: ["main"];
outputs: ["main"];
outputNames: ["Group Output"];
icon: "file:icon.svg";
```

### Parameters

| Name          | Display Name         | Type    | Default         | Description                                                               |
| ------------- | -------------------- | ------- | --------------- | ------------------------------------------------------------------------- |
| groupLabel    | Group Label          | string  | group_1         | Unique name for this group. Used in output data and logs.                 |
| groupTimeout  | Group Timeout (ms)   | number  | 0               | If > 0, total time allowed for the entire group. 0 means no timeout.      |
| errorStrategy | Group Error Strategy | options | continueOnError | stopOnFirst / continueOnError / collectErrors — same semantics as DagJoin |
| description   | Group Description    | string  | (empty)         | Human-readable note about what this group does.                           |

### Execute Logic — Step by Step

1. Get all input items
2. For each item:
   a. Merge into `item.json`:
   ```typescript
   {
     _dagGroupLabel: groupLabel,
     _dagGroupTimeout: groupTimeout,
     _dagGroupErrorStrategy: errorStrategy,
     _dagGroupDescription: description,
     _dagGroupEnteredAt: new Date().toISOString()
   }
   ```
   b. Copy `item.binary` to output item
3. Pass all items to output 0

### Usage Pattern

```
[DagGroup: "Image Processing"]
        |
   [DAG Split: 3]
   |     |     |
  ...   ...   ...
        |
   [DAG Join]    <- end of the group
        |
[next node in parent workflow]
```

---

## 13. SHARED DAG CONTEXT — COMPLETE FIELD REFERENCE

Every item flowing through any of the seven nodes carries these fields on `item.json`. All nodes must read and write these correctly. Never invent new `_dag` prefixed fields not listed here.

```typescript
// Set by DagSplit
_dagExecutionId: string
_dagTotalBranches: number
_dagBranchIndex: number
_dagBranchLabel: string          // overwritten by DagTry with user's label
_dagStatus: DagStatus
_dagTimestamp: string

// Set by DagTry
_dagBranchLabel: string          // user-defined e.g. 'image_storage'
_dagOperationLabel: string
_dagTimeoutMs: number
_dagSkipOnTimeout: boolean
_dagFallbackData: object
_dagMaxRetry: number
_dagRetryDelayMs: number
_dagRetryBackoff: 'none' | 'linear' | 'exponential'
_dagRetryOn4xx: boolean
_dagRetryOn5xx: boolean

// Set by DagCatch
_dagCatchRan: boolean
_dagError?: string

// Set by DagFinally
_dagFinallyRan: boolean
_dagFinalTimestamp: string
_dagCleanupNote?: string

// Set by DagJoin (on output only)
_dagJoinMode: string
_dagCompletedAt: string
_dagTimedOut: boolean

// Set by DagLoop
_dagLoopId: string
_dagLoopComplete: boolean

// Set by DagGroup
_dagGroupLabel: string
_dagGroupTimeout: number
_dagGroupErrorStrategy: string
_dagGroupDescription: string
_dagGroupEnteredAt: string
```

**Valid \_dagStatus values:**

```typescript
type DagStatus =
  | "running" // DagSplit
  | "try_running" // DagTry success path
  | "try_failed" // DagTry failure path
  | "skipped" // runCondition was false
  | "catch_recovered" // DagCatch fallback mode
  | "catch_failed" // DagCatch rethrow mode
  | "completed" // DagFinally — success
  | "failed" // DagFinally — failed
  | "timeout"; // timeout exceeded
```

---

## 14. BINARY DATA HANDLING RULES — MANDATORY

Binary data gets lost in n8n sub-workflows. This package keeps binary in memory at every step. These rules are non-negotiable:

1. Every node must copy `item.binary` to its output items: `outputItem.binary = inputItem.binary || {}`
2. Never drop binary even if a node only cares about JSON
3. DagSplit must copy binary to ALL branch copies of each item
4. DagJoin in `merged` mode collects binary from all branches into one binary object keyed by branchLabel
5. DagJoin in `array` mode returns each branch item with its own binary
6. DagLoop must copy the original input binary to every Loop Body output item

---

## 15. CONNECTION RULES

Valid connection patterns only. Do not allow other combinations.

```
Pattern A — Parallel branches with error handling:
[Any Node]
    |
[DagSplit]
 |       |
[DagTry] [DagTry]
 | Success  | Success
[nodes]    [nodes]
 | Failure
[DagCatch]
 |
[nodes]
 |      |
[DagFinally] [DagFinally]
       |           |
       [DAG Join: expectedBranchCount=2]
                |
           [Any Node]

Pattern B — Loop:
[Any Node]
    |
[DagLoop]
 | Loop Body     | Done
[user nodes]    [next step]
 |
[back to DagLoop or continue]

Pattern C — Group wrapping a DAG:
[Any Node] -> [DagGroup] -> [DagSplit] -> ... -> [DagJoin] -> [Any Node]

Pattern D — Nested groups:
[DagGroup outer] -> [DagSplit] -> [DagGroup inner] -> [DagSplit] -> [DagJoin] -> [DagJoin]
```

**Critical rule:**
Branches communicate ONLY through `_dagContext` fields on `item.json` and DagJoin's static data. Never pass data from one branch to another via a physical n8n connection — this causes race conditions.

---

## 16. FILE STRUCTURE AFTER FULL MIGRATION

```
nodes/
  DagOrchestrator/
    DagSplit.node.ts          <- CREATE
    DagTry.node.ts            <- CREATE
    DagCatch.node.ts          <- CREATE
    DagFinally.node.ts        <- CREATE
    DagJoin.node.ts           <- CREATE
    DagLoop.node.ts           <- CREATE
    DagGroup.node.ts          <- CREATE
    DagOrchestrator.node.ts   <- DELETE
    icon.svg                  <- KEEP
    engine/                   <- KEEP ENTIRE FOLDER — DO NOT TOUCH
      DagEngine.ts
      BranchExecutor.ts
      StateManager.ts
      DependencyResolver.ts
      LoopController.ts
      __tests__/
    types/                    <- KEEP ENTIRE FOLDER — DO NOT TOUCH
      Branch.types.ts
      Dag.types.ts
      State.types.ts
package.json                  <- UPDATE (Section 4.1)
README.md                     <- REWRITE (Section 4.2)
tsconfig.json                 <- KEEP
tsconfig.build.json           <- KEEP
jest.config.js                <- KEEP
```

---

## 17. REAL-WORLD EXAMPLE — IMAGE PROCESSING FLOW

**Scenario:** Receive a binary image. Store it to Drive AND extract metadata in parallel. Then generate a thumbnail.

```
[Manual Trigger]
       |
  [DAG Split]  branchCount: 3
   |       |       |
  B1      B2      B3

B1:
[DAG Try] branchLabel:"image_storage" timeout:60000 maxRetry:3
  | Success                      | Failure
[HTTP Request: save to Drive]  [DAG Catch: fallback={path:"/error"}]
  |                                       |
  +------[DAG Finally: "image_storage"]---+
                     |
              [DAG Join] <---------+
                                   |
B2:                                |
[DAG Try] branchLabel:"metadata" timeout:30000 skipOnTimeout:true
  | Success
[Code: extract dimensions]
  |
[DAG Finally: "metadata"] ---------+
                                   |
                            [DAG Join] <--+
                                          |
B3:                                       |
[DAG Try] branchLabel:"thumbnail"         |
  | Success                               |
[Code: generate thumbnail]                |
  |                                       |
[DAG Finally: "thumbnail"] ---------------+
                                          |
                                    [DAG Join]
                               expectedBranchCount:3
                               joinMode:waitForAll
                               outputFormat:merged
                                          |
                                   [next node]
```

---

## 18. QUICK REFERENCE TABLE

| Node       | User configures                                                 | Connects to                                              |
| ---------- | --------------------------------------------------------------- | -------------------------------------------------------- |
| DagSplit   | Branch Count (2-6), ID Prefix                                   | Output pins to DagTry nodes                              |
| DagTry     | Branch Label, timeout, retry, condition                         | Success -> user nodes -> DagFinally; Failure -> DagCatch |
| DagCatch   | Branch Label, recovery mode, fallback                           | Output -> user recovery nodes -> DagFinally              |
| DagFinally | Branch Label (must match DagTry)                                | Output -> DagJoin                                        |
| DagJoin    | Expected Branch Count, Join Mode, Output Format, Error Strategy | Input from all DagFinally nodes                          |
| DagLoop    | Source field, batch size, break/continue, index names           | Loop Body -> user nodes; Done -> next step               |
| DagGroup   | Group label, timeout, error strategy                            | Output -> DagSplit to start inner DAG                    |

---

## 19. FINAL CHECKLIST BEFORE COMMITTING

- [ ] `DagOrchestrator.node.ts` is deleted
- [ ] All 7 new node files exist and compile with zero TypeScript errors
- [ ] `package.json` `n8n.nodes` lists all 7 new nodes
- [ ] `package.json` version is bumped to `0.2.0`
- [ ] `npm run lint` passes with zero warnings
- [ ] `npm run build` succeeds
- [ ] README is updated
- [ ] No files in `engine/` or `types/` were modified
- [ ] Every new node copies `item.binary` through to its outputs
- [ ] DagJoin and DagLoop use `getWorkflowStaticData('node')` for state
- [ ] All `_dagContext` fields follow exact names in Section 13
- [ ] DagJoin returns `[]` when join condition not yet met (not an error)
- [ ] DagSplit unused output pins return `[]` not errors

---

_End of AGENTS.md — n8n-nodes-dag-orchestrator v0.2.0_
