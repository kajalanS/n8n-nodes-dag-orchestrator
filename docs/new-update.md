# AGENTS.md — n8n-nodes-dag-orchestrator

## Multi-Node Migration Guide for AI Coding Assistants

> **Read this entire file before writing a single line of code.**
> This document is the single source of truth for all implementation decisions.

---

## 1. PROJECT CONTEXT

This is an n8n community node package that provides Blueprint-style DAG (Directed Acyclic Graph) workflow orchestration. It is inspired by Unreal Engine's Blueprint visual scripting system — users connect nodes visually rather than writing JSON config.

The package is published under `@Ksoftm/n8n-nodes-dag-orchestrator`.

---

## 2. WHAT YOU MUST NEVER TOUCH

The following files and folders are **complete, tested, and working**. Do NOT modify, delete, or refactor them under any circumstances:

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

These engine files contain:

- Kahn's Algorithm topological sort for dependency resolution
- Parallel execution via Promise.all
- Try/catch/finally per branch
- Retry logic with none/linear/exponential backoff
- 4xx vs 5xx retry differentiation
- Global and per-branch timeout handling
- Binary buffer management (in-memory, no serialisation)
- Loop controller with index tracking, break/continue, nested loop isolation
- Subgraph/group nesting via child DagEngine instantiation
- StateManager with isolated execution state per run

**The engine is the foundation. It stays exactly as-is.**

---

## 3. WHAT YOU MUST DELETE

Delete this single file only:

```
nodes/DagOrchestrator/DagOrchestrator.node.ts
```

This is the old single-node implementation that exposed a raw JSON config field to users. It is being replaced by the six-node system described in Section 5. Do not keep any code from this file.

---

## 4. WHAT YOU MUST UPDATE

### 4.1 package.json

Update the `n8n.nodes` array to register all six new nodes. Replace the existing single entry with:

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
      "dist/nodes/DagOrchestrator/DagLoop.node.js"
    ]
  }
}
```

### 4.2 tsconfig.json / tsconfig.build.json

No changes needed. The existing TypeScript configuration already compiles everything under `nodes/`.

### 4.3 README.md

Replace the entire README with documentation for the new multi-node system. Describe each node, show a visual flow diagram using ASCII art, and include the image processing example from Section 8.

---

## 5. THE SIX NEW NODES — FULL SPECIFICATION

Create all six files inside `nodes/DagOrchestrator/`. Each file is a standalone n8n node class.

---

### 5.1 DagSplit.node.ts

**Purpose:** Takes one input and routes it to multiple output branches simultaneously. This is the starting point of every DAG flow.

**Display Name:** `DAG Split`
**Node Name (internal):** `dagSplit`
**Group:** `['transform']`
**Icon:** `file:icon.svg`

**Inputs:** `['main']` — one input

**Outputs:** Dynamic based on `branchCount` parameter. Maximum is 6. Use this output definition pattern:

```typescript
outputs: ["main", "main", "main", "main", "main", "main"].slice(0, branchCount);
```

Since n8n requires outputs to be defined at description time, use a fixed maximum of 6 outputs and label unused ones. The actual number shown is controlled by `branchCount`.

**Output Labels:** Branch 1, Branch 2, Branch 3, Branch 4, Branch 5, Branch 6 (only show up to branchCount)

**Parameters:**

| Parameter           | Type                | Default | Description                                  |
| ------------------- | ------------------- | ------- | -------------------------------------------- |
| Branch Count        | options (2,3,4,5,6) | 2       | How many parallel branches to create         |
| Execution ID Prefix | string              | `dag`   | Optional prefix for the execution context ID |

**Execute Logic:**

1. Generate a unique `_dagExecutionId` using `Date.now() + Math.random()` combined with the prefix
2. For each input item, attach `_dagExecutionId`, `_dagTotalBranches`, and `_dagBranchIndex` to `item.json`
3. Route ALL items to ALL output pins (not split — every branch gets the full input)
4. Return an array of arrays — one array per branch, all containing the same items with the context attached

**Context Object Structure (attached to every item.json):**

```typescript
{
  _dagExecutionId: string,       // unique ID for this DAG run
  _dagTotalBranches: number,     // how many branches were created
  _dagBranchIndex: number,       // which branch this item is on (0-based)
  _dagBranchLabel: string,       // "Branch 1", "Branch 2" etc.
  _dagStatus: 'running'          // will be updated downstream
}
```

---

### 5.2 DagTry.node.ts

**Purpose:** Marks the start of a try block on a branch. Passes data through on success. Routes to the failure output on error. Supports retry and timeout.

**Display Name:** `DAG Try`
**Node Name (internal):** `dagTry`
**Group:** `['transform']`

**Inputs:** `['main']`
**Outputs:** Two outputs — label them `['Success', 'Failure']`

**Parameters:**

| Parameter           | Type                              | Default        | Description                                                                                     |
| ------------------- | --------------------------------- | -------------- | ----------------------------------------------------------------------------------------------- |
| Branch Label        | string                            | `branch_1`     | Identifier for this branch. Used by DagJoin to match results. Must be unique within a DAG flow. |
| Operation Label     | string                            | `My Operation` | Human-readable name shown in execution logs                                                     |
| Timeout (ms)        | number                            | 0              | 0 means no timeout. Any value > 0 wraps execution in a timer.                                   |
| Max Retry Attempts  | number                            | 1              | 1 means no retry. Set higher to retry on failure.                                               |
| Retry Delay (ms)    | number                            | 1000           | Delay between retry attempts                                                                    |
| Retry Backoff       | options (none/linear/exponential) | none           | Backoff strategy for retries                                                                    |
| Retry on 4xx Errors | boolean                           | false          | Whether to retry when a 4xx HTTP status error occurs                                            |
| Retry on 5xx Errors | boolean                           | true           | Whether to retry when a 5xx HTTP status error occurs                                            |

**Execute Logic:**

1. Read all input items
2. Attach `_dagBranchLabel` from the Branch Label parameter to each item
3. Mark `_dagStatus: 'try_running'` on each item
4. Pass all items to **output 0 (Success)**
5. If an error occurs during this node's own execution, attach `_dagStatus: 'try_failed'` and `_dagError: error.message` and route to **output 1 (Failure)**

**Important:** DagTry itself does not execute user logic — it passes data through and tracks state. The actual user operations happen in regular n8n nodes placed AFTER DagTry on the Success path. DagTry's role is to set up the context and handle routing on failure.

---

### 5.3 DagCatch.node.ts

**Purpose:** Handles the failure path from DagTry. Receives items that failed, allows recovery logic via normal n8n nodes placed after it, and passes recovered items forward.

**Display Name:** `DAG Catch`
**Node Name (internal):** `dagCatch`
**Group:** `['transform']`

**Inputs:** `['main']` — connects to the Failure output of DagTry
**Outputs:** `['main']` — one output (the recovered path)

**Parameters:**

| Parameter      | Type    | Default    | Description                                                                 |
| -------------- | ------- | ---------- | --------------------------------------------------------------------------- |
| Recovery Mode  | options | `fallback` | `fallback` uses fallback data; `rethrow` marks branch as permanently failed |
| Fallback Value | json    | `{}`       | The fallback JSON data to use when recovery mode is fallback                |
| Log Error      | boolean | true       | Whether to include error details in the output item                         |

**Execute Logic:**

1. Receive items from DagTry's Failure output
2. If Recovery Mode is `fallback`: attach the fallback value to each item's json, mark `_dagStatus: 'catch_recovered'`
3. If Recovery Mode is `rethrow`: mark `_dagStatus: 'catch_failed'`, throw error upward
4. Pass items to output — these will flow through user-defined recovery nodes and eventually into DagFinally

---

### 5.4 DagFinally.node.ts

**Purpose:** Always runs at the end of a branch regardless of success or failure. Used for cleanup operations. Passes items through after marking final status.

**Display Name:** `DAG Finally`
**Node Name (internal):** `dagFinally`
**Group:** `['transform']`

**Inputs:** `['main']`
**Outputs:** `['main']`

**Parameters:**

| Parameter    | Type    | Default    | Description                                                                                   |
| ------------ | ------- | ---------- | --------------------------------------------------------------------------------------------- |
| Branch Label | string  | `branch_1` | Must match the Branch Label set in the corresponding DagTry node                              |
| Mark Status  | options | `auto`     | `auto` detects success/failure from context; `success` forces success; `failed` forces failed |
| Cleanup Note | string  | ``         | Optional human-readable note added to execution log                                           |

**Execute Logic:**

1. Receive items (from either the success path or catch path)
2. Determine final status from `_dagStatus` on each item or from Mark Status parameter
3. Mark `_dagStatus: 'completed'` or `_dagStatus: 'failed'` on each item
4. Add `_dagFinallyRan: true` to each item
5. Pass all items to output — they will flow into DagJoin

---

### 5.5 DagJoin.node.ts

**Purpose:** Collects results from all branches and merges them into one output. Waits for all branches before proceeding (based on Join Mode). This is the most complex node.

**Display Name:** `DAG Join`
**Node Name (internal):** `dagJoin`
**Group:** `['transform']`

**Inputs:** `['main']` — receives from all branch paths
**Outputs:** `['main']` — one merged output

**Parameters:**

| Parameter             | Type    | Default           | Description                                                                                                                                 |
| --------------------- | ------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Expected Branch Count | number  | 2                 | Must match the Branch Count set in DagSplit                                                                                                 |
| Join Mode             | options | `waitForAll`      | `waitForAll`: wait for every branch; `waitForFirst`: proceed when first branch arrives; `waitForAny`: proceed when any branch completes     |
| Output Format         | options | `merged`          | `merged`: single object with branch results; `array`: array of per-branch results; `passthrough`: first branch result only                  |
| Error Strategy        | options | `continueOnError` | `stopOnFirst`: stop if any branch failed; `continueOnError`: include failed branches in output; `collectErrors`: add errors array to output |
| Global Timeout (ms)   | number  | 60000             | How long to wait for all branches before timing out                                                                                         |

**Execute Logic:**

1. Receive incoming items. Read `_dagExecutionId` from each item to group them by execution
2. Use `this.getWorkflowStaticData('node')` to store partial results between invocations — this is how DagJoin accumulates results as branches arrive one by one
3. Group accumulated items by `_dagBranchLabel`
4. When the number of unique branch labels equals Expected Branch Count (or Join Mode condition is met): merge results and emit to output
5. If Global Timeout is exceeded: emit whatever has been collected so far with a timeout flag
6. Clear the static data for this execution ID after emitting

**Merge Output Structure:**

```typescript
{
  json: {
    _dagExecutionId: string,
    _dagJoinMode: string,
    _dagCompletedAt: string,         // ISO timestamp
    branches: {
      [branchLabel: string]: {
        status: string,              // 'completed' | 'failed' | 'timeout'
        data: any[],                 // the items from this branch
        error?: string               // if failed
      }
    },
    errors?: any[],                  // only if errorStrategy is 'collectErrors'
    timedOut?: boolean               // only if global timeout was hit
  }
}
```

**Critical Note on Static Data:**
DagJoin uses n8n's `getWorkflowStaticData('node')` to hold partial branch results between separate execution calls. This is the mechanism that allows it to wait for multiple branches. This only works correctly on **self-hosted n8n**. Document this requirement clearly in the README.

---

### 5.6 DagLoop.node.ts

**Purpose:** Loops over an array of items with built-in index tracking. Fixes the known n8n nested loop bug by maintaining its own isolated loop state. No sub-workflows needed.

**Display Name:** `DAG Loop`
**Node Name (internal):** `dagLoop`
**Group:** `['transform']`

**Inputs:** `['main']`
**Outputs:** Two outputs — label them `['Loop Body', 'Done']`

**Parameters:**

| Parameter           | Type   | Default        | Description                                                               |
| ------------------- | ------ | -------------- | ------------------------------------------------------------------------- |
| Source Field        | string | `items`        | The field in the input JSON that contains the array to loop over          |
| Batch Size          | number | 1              | How many items to process per iteration. 1 = one at a time.               |
| Max Iterations      | number | 1000           | Hard limit to prevent infinite loops                                      |
| Index Variable Name | string | `currentIndex` | Name of the index field added to each output item                         |
| Total Variable Name | string | `totalItems`   | Name of the total count field added to each output item                   |
| Break Condition     | string | ``             | n8n expression evaluated after each iteration. Loop stops if true.        |
| Continue Condition  | string | ``             | n8n expression evaluated before each iteration. Skips iteration if false. |

**Execute Logic:**

1. Read the source array from `item.json[sourceField]`
2. Use `this.getWorkflowStaticData('node')` to track current loop position across invocations
3. On each execution call, get the next batch of items (based on Batch Size)
4. For each item in the batch: attach `currentIndex` (or whatever the Index Variable Name is), `totalItems`, `isFirstItem`, `isLastItem` to the item's json
5. Route current batch items to **output 0 (Loop Body)**
6. When all items have been processed (or Break Condition is true, or Max Iterations reached): route a single summary item to **output 1 (Done)** containing loop stats
7. Clear static data for this loop after emitting Done

**Done Output Structure:**

```typescript
{
  json: {
    _dagLoopComplete: true,
    totalIterations: number,
    itemsProcessed: number,
    brokeEarly: boolean,
    source: string            // which field was looped over
  }
}
```

---

## 6. SHARED CONTEXT OBJECT — FULL SPECIFICATION

Every item flowing through the DAG node family carries this context on its `json` property. All nodes read and write to these fields:

```typescript
interface DagContext {
  _dagExecutionId: string; // Set by DagSplit. Never changed.
  _dagTotalBranches: number; // Set by DagSplit. Never changed.
  _dagBranchIndex: number; // Set by DagSplit. 0-based.
  _dagBranchLabel: string; // Set by DagTry. Used by DagJoin for grouping.
  _dagStatus:
    | "running"
    | "try_running"
    | "try_failed"
    | "catch_recovered"
    | "catch_failed"
    | "completed"
    | "failed"
    | "timeout"
    | "skipped";
  _dagError?: string; // Error message if status is failed
  _dagFinallyRan?: boolean; // Set by DagFinally
  _dagTimestamp?: string; // ISO timestamp of last status change
}
```

---

## 7. FILE STRUCTURE AFTER MIGRATION

```
nodes/
  DagOrchestrator/
    DagSplit.node.ts          ← NEW — create this
    DagTry.node.ts            ← NEW — create this
    DagCatch.node.ts          ← NEW — create this
    DagFinally.node.ts        ← NEW — create this
    DagJoin.node.ts           ← NEW — create this
    DagLoop.node.ts           ← NEW — create this
    icon.svg                  ← KEEP as-is
    engine/
      DagEngine.ts            ← DO NOT TOUCH
      BranchExecutor.ts       ← DO NOT TOUCH
      StateManager.ts         ← DO NOT TOUCH
      DependencyResolver.ts   ← DO NOT TOUCH
      LoopController.ts       ← DO NOT TOUCH
      __tests__/              ← DO NOT TOUCH
    types/
      Branch.types.ts         ← DO NOT TOUCH
      Dag.types.ts            ← DO NOT TOUCH
      State.types.ts          ← DO NOT TOUCH
package.json                  ← UPDATE n8n.nodes array (see Section 4.1)
README.md                     ← UPDATE with new node documentation
```

**DELETE this file:**

```
nodes/DagOrchestrator/DagOrchestrator.node.ts   ← DELETE
```

---

## 8. REAL-WORLD EXAMPLE — HOW THE NODES CONNECT

Image processing use case: receive a binary image, store it, extract metadata, generate thumbnail.

```
[Manual Trigger]
       ↓
  [DAG Split]  ←— Branch Count: 3
   ↓    ↓    ↓
   B1   B2   B3
   ↓
[DAG Try]  branchLabel: "image_storage"
   ↓ Success
[HTTP Request - save to Drive]
   ↓
[DAG Finally]  branchLabel: "image_storage"
   ↓
[DAG Join] ←—————————————————————————┐
                                      │
         B2                           │
          ↓                           │
      [DAG Try]  branchLabel: "metadata"
          ↓ Success   ↓ Failure       │
      [Code Node]  [DAG Catch]        │
          ↓             ↓             │
      [DAG Finally] branchLabel: "metadata"
          ↓                           │
          └———————————————————————————┤
                                      │
         B3                           │
          ↓                           │
      [DAG Try]  branchLabel: "thumbnail"
          ↓ Success                   │
      [Code Node - resize]            │
          ↓                           │
      [DAG Finally] branchLabel: "thumbnail"
          ↓                           │
          └———————————————————————————┘
                                      ↓
                               [DAG Join output]
                                      ↓
                          [next node in workflow]
```

---

## 9. CONSTRAINTS AND KNOWN LIMITATIONS

| Constraint                                | Detail                                                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Max branches in DagSplit                  | 6. Fixed maximum. n8n does not support truly dynamic output pin counts at runtime.                        |
| DagJoin requires self-hosted n8n          | Uses `getWorkflowStaticData` which does not work reliably on n8n cloud. Document this.                    |
| No runtime npm dependencies               | Verified community nodes cannot use runtime npm packages. All logic must be self-contained in TypeScript. |
| Binary data in DagJoin                    | Large binary files held in memory until all branches complete. Document practical size limits.            |
| Branch Label must be unique               | DagTry's Branch Label must be unique within a single DAG flow. DagJoin uses it to group results.          |
| DagFinally Branch Label must match DagTry | These two nodes are paired. Mismatched labels will cause DagJoin to wait forever.                         |

---

## 10. PUBLISHING REQUIREMENTS

Before publishing a new version:

- All six nodes must be registered in `package.json` under `n8n.nodes`
- `npm run lint` must pass with zero warnings
- `npm run build` must succeed with no TypeScript errors
- README must be updated to describe the new multi-node system
- Version in `package.json` must be bumped (from 0.1.x to 0.2.0 for this major UI change)
- From May 1st 2026, publishing for verification requires GitHub Actions with provenance. Ensure `.github/workflows/publish.yml` is configured before that date.

---

## 11. SUMMARY OF ACTIONS FOR THE AI

| Action    | Target                                                   |
| --------- | -------------------------------------------------------- |
| ✅ KEEP   | `engine/` folder — all 5 files                           |
| ✅ KEEP   | `types/` folder — all 3 files                            |
| ✅ KEEP   | `icon.svg`                                               |
| ✅ KEEP   | `tsconfig.json`, `tsconfig.build.json`, `jest.config.js` |
| ❌ DELETE | `DagOrchestrator.node.ts`                                |
| 🆕 CREATE | `DagSplit.node.ts`                                       |
| 🆕 CREATE | `DagTry.node.ts`                                         |
| 🆕 CREATE | `DagCatch.node.ts`                                       |
| 🆕 CREATE | `DagFinally.node.ts`                                     |
| 🆕 CREATE | `DagJoin.node.ts`                                        |
| 🆕 CREATE | `DagLoop.node.ts`                                        |
| ✏️ UPDATE | `package.json` — n8n.nodes array                         |
| ✏️ UPDATE | `README.md` — full rewrite for new system                |

---

_End of AGENTS.md_
