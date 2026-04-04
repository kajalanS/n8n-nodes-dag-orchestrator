# n8n-nodes-dag-orchestrator — Multi-Node Blueprint DAG Orchestration

> **Blueprint-style DAG orchestration for n8n.**
> Visual, parallel, robust. Inspired by Unreal Engine Blueprints.

---

## Overview

This package provides a family of six n8n nodes for building complex, parallel, and robust workflows using a Directed Acyclic Graph (DAG) model. Each node is a building block—combine them visually to orchestrate multi-branch flows with try/catch/finally, joins, and loops.

- **No JSON configs**
- **No sub-workflows**
- **No code required**

---

## The Six Nodes

| Node         | Purpose                                                      |
|--------------|--------------------------------------------------------------|
| DAG Split    | Start a DAG, split into parallel branches                    |
| DAG Try      | Mark start of a branch, set retry/timeout, track errors      |
| DAG Catch    | Handle branch failures, recover or rethrow                   |
| DAG Finally  | Always runs at end of branch for cleanup/status marking      |
| DAG Join     | Wait for all branches, merge results, handle errors/timeouts |
| DAG Loop     | Loop over arrays with isolated state, supports break/continue|

---

## Visual Flow Example (ASCII Art)

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

## Node Details

### DAG Split
- **Purpose:** Start a DAG, split input to up to 6 parallel branches
- **Parameters:** Branch Count (2–6), Execution ID Prefix
- **Outputs:** Up to 6, each labeled Branch 1–6
- **Context:** Adds `_dagExecutionId`, `_dagTotalBranches`, `_dagBranchIndex`, `_dagBranchLabel`, `_dagStatus: running`

### DAG Try
- **Purpose:** Start a branch, set retry/timeout, track errors
- **Parameters:** Branch Label (unique), Operation Label, Timeout, Retry options
- **Outputs:** Success, Failure
- **Context:** Adds `_dagBranchLabel`, `_dagStatus: try_running` or `try_failed`, `_dagError`

### DAG Catch
- **Purpose:** Handle failures from DagTry, recover or rethrow
- **Parameters:** Recovery Mode (fallback/rethrow), Fallback Value, Log Error
- **Outputs:** Main (recovered path)
- **Context:** Sets `_dagStatus: catch_recovered` or `catch_failed`

### DAG Finally
- **Purpose:** Always runs at end of branch, for cleanup/status marking
- **Parameters:** Branch Label (must match DagTry), Mark Status (auto/success/failed), Cleanup Note
- **Outputs:** Main
- **Context:** Sets `_dagStatus: completed` or `failed`, `_dagFinallyRan: true`

### DAG Join
- **Purpose:** Wait for all branches, merge results, handle errors/timeouts
- **Parameters:** Expected Branch Count, Join Mode, Output Format, Error Strategy, Global Timeout
- **Outputs:** Main (merged result)
- **Context:** Merges all branch results, uses `_dagExecutionId`, `_dagBranchLabel`
- **Note:** Uses n8n static data—**requires self-hosted n8n**

### DAG Loop
- **Purpose:** Loop over arrays with isolated state, supports break/continue
- **Parameters:** Source Field, Batch Size, Max Iterations, Index/Total Variable Names, Break/Continue Conditions
- **Outputs:** Loop Body, Done (summary)
- **Context:** Tracks loop state, outputs `currentIndex`, `totalItems`, etc.

---

## Shared Context Object

Every item carries this context in `item.json`:

```typescript
interface DagContext {
  _dagExecutionId: string;
  _dagTotalBranches: number;
  _dagBranchIndex: number;
  _dagBranchLabel: string;
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
  _dagError?: string;
  _dagFinallyRan?: boolean;
  _dagTimestamp?: string;
}
```

---

## Real-World Example: Image Processing

**Goal:** Receive a binary image, store it, extract metadata, generate thumbnail—all in parallel, robustly.

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

## Constraints & Known Limitations

| Constraint                                | Detail                                                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Max branches in DagSplit                  | 6. Fixed maximum. n8n does not support truly dynamic output pin counts at runtime.                        |
| DagJoin requires self-hosted n8n          | Uses `getWorkflowStaticData` which does not work reliably on n8n cloud. Document this.                    |
| No runtime npm dependencies               | Verified community nodes cannot use runtime npm packages. All logic must be self-contained in TypeScript. |
| Binary data in DagJoin                    | Large binary files held in memory until all branches complete. Document practical size limits.            |
| Branch Label must be unique               | DagTry's Branch Label must be unique within a single DAG flow. DagJoin uses it to group results.          |
| DagFinally Branch Label must match DagTry | These two nodes are paired. Mismatched labels will cause DagJoin to wait forever.                         |

---

## Publishing & Verification

- All six nodes must be registered in `package.json` under `n8n.nodes`
- `npm run lint` and `npm run build` must pass
- README must describe the new multi-node system
- Version must be bumped for major changes
- From May 2026, GitHub Actions provenance is required for verification

---

## Credits

- Inspired by Unreal Engine Blueprints
- Built for the n8n community
