# n8n-nodes-dag-orchestrator

**Blueprint-Style DAG Workflow Orchestration for n8n**

Bring Unreal Engine Blueprint-style visual workflow orchestration to n8n. Instead of a single node with raw JSON config, use seven purpose-built, visually connected nodes to build parallel workflows with full dependency management, error handling, and binary data preservation.

## What This Package Does

This community node package solves key n8n limitations:

- **Parallel branches with dependency management** — n8n cannot natively run parallel branches that wait for each other with complex logic
- **Binary data preservation** — binary data is lost in sub-workflows
- **Nested loops without index corruption** — loop index tracking breaks with nested loops
- **Built-in error handling** — try/catch/finally per branch without complex workflow setup
- **Loop control** — break/continue conditions without manual global state hacks

Build complex DAGs visually by connecting small, focused nodes—no JSON configs, no sub-workflows, no code required.

## Installation

1. In n8n, open **Community Nodes** (gear icon → Community Nodes)
2. Search for **dag-orchestrator**
3. Click **Install**
4. Restart n8n

Or via npm (for development):

```bash
cd ~/.n8n/nodes  # or your n8n user directory
npm install @ksoftm/n8n-nodes-dag-orchestrator
```

## The Seven Nodes

| Node        | Purpose                                                             |
| ----------- | ------------------------------------------------------------------- |
| DAG Split   | Start a DAG, split input into parallel branches (2–6 outputs)       |
| DAG Try     | Mark start of a branch, set retry/timeout, route to Success/Failure |
| DAG Catch   | Handle failures from DAG Try, recover or fail downstream            |
| DAG Finally | Always runs at end of branch for cleanup and status finalization    |
| DAG Join    | Collect and merge results from all branches into one output         |
| DAG Loop    | Loop over arrays with isolated index tracking, break/continue       |
| DAG Group   | Group branches into a named logical container (subgraph)            |

## Visual Flow Example

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Image Processing Flow                       │
└─────────────────────────────────────────────────────────────────────┘

[Manual Trigger]
       │
       ▼
  [DAG Split]  ←── branchCount: 3
   │    │    │
   │    │    └─────────────────────┐
   │    │                          │
   │    ▼                          │
   │ [DAG Try]                     │
   │ "metadata"                    │
   │    │ Success                  │
   │    ▼                          │
   │ [Code: extract]               │
   │    │                          │
   │    ▼                          │
   │ [DAG Finally]                 │
   │ "metadata"                    │
   │    │                          │
   ▼    │                          │
[DAG Try]      [DAG Try]            │
"image_storage" "thumbnail"         │
   │ Success │ Success             │
   ▼         ▼                      │
[HTTP:     [Code:                  │
 save to    resize]                │
 Drive]  │                         │
   │     ▼                         │
   │  [DAG Finally]                │
   │  "thumbnail"                  │
   │     │                         │
   ▼     ▼                         ▼
[DAG Finally] ← [DAG Finally] ← [DAG Finally]
"image_storage" "metadata"    "thumbnail"
   │              │                │
   └──────────────┼────────────────┘
                  ▼
            [DAG Join]
        expectedBranchCount: 3
        joinMode: waitForAll
        outputFormat: merged
                  │
                  ▼
            [Next Node]

Result: {
  branches: {
    image_storage: { status: "completed", data: [...] },
    metadata: { status: "completed", data: [...] },
    thumbnail: { status: "completed", data: [...] }
  }
}
```

## How It Works

1. **DAG Split** creates a unique execution context and routes input to all branches
2. **DAG Try** marks branch start, enforces retry/timeout policies, routes success/failure
3. User nodes run on the success path
4. **DAG Catch** (optional) recovers from failures
5. **DAG Finally** marks branch completion, ensures all branches reach the join
6. **DAG Join** waits for all branches using static data, merges results
7. Binary data is preserved at every step

For loops, use **DAG Loop** to iterate without sub-workflows:

- Automatically tracks loop index and total items
- Routes each batch to "Loop Body" output
- Routes completion summary to "Done" output
- Supports break/continue conditions

## Important Notes

### Self-Hosted n8n Required

**DAG Join** and **DAG Loop** use `getWorkflowStaticData('node')` to maintain state across multiple execution calls. This feature is only available in **self-hosted n8n**. It does not work in n8n Cloud.

### Verified Community Node Publishing

As of May 1, 2026, n8n requires verified community node publishing via GitHub Actions with provenance signatures. This package will comply with those requirements.

### Binary Data is Preserved

Unlike sub-workflows, all nodes in this package preserve binary data at every step. Binary buffers are never serialized—they stay in memory throughout the workflow execution.

## Connection Rules

Valid patterns:

```
Pattern A: Parallel Branches with Error Handling
[Any Node]
    ↓
[DAG Split]
  ↙ ↓ ↘
[DAG Try] [DAG Try] [DAG Try]
  │ Success ↓ Success ↓ Success
  ├────────→[ops]→[ops]→
  │          │ Failure
  ├─────────→[DAG Catch]
  │               ↓
  ├────────────────[DAG Finally]
  │   │   │
  └─→ ↓   ↓
   [DAG Join]
     ↓
 [Any Node]

Pattern B: Looping
[Any Node]
    ↓
[DAG Loop]  ←──────────┐
  ↙         ↘          │
[Loop Body] [Done]     │
  ↓                    │
[ops] → [repeat?] ────┘
  ↓
[Next Step]

Pattern C: Grouped DAGs
[Any Node] → [DAG Group] → [DAG Split] → ... → [DAG Join] → [Any Node]

Pattern D: Nested Groups
[DAG Group] → [DAG Split] → [DAG Group] → [DAG Split] → [DAG Join] → [DAG Join]
```

## Context Fields

Every item carries DAG context in `item.json`. Key fields:

```typescript
_dagExecutionId; // Unique ID for this DAG run
_dagBranchLabel; // e.g., "image_storage", "metadata"
_dagStatus; // "running" | "try_running" | "completed" | "failed" | ...
_dagError; // Error message if failed
_dagTimeoutMs; // Timeout in ms (set by DAG Try)
_dagMaxRetry; // Max retry attempts
_dagRetryDelayMs; // Delay between retries
_dagLoopId; // Loop ID (DAG Loop)
_dagGroupLabel; // Group name (DAG Group)
```

See the [specification document](docs/next-version.md) for the complete field reference.

## Examples

### Image Processing (Binary + Parallel)

Receive an image, save to Drive AND extract metadata in parallel, then generate thumbnail.

```
Manual Trigger
    ↓
[DAG Split: 3 branches]
    ↙    ↓     ↘
Save  Extract Thumbnail
    ↓    ↓     ↓
   DAG Try (timeout: 60s, retry: 3)
    ↓
   [HTTP POST to Drive]
    ↓
   [DAG Finally]
    ↓
   [DAG Join]
    ↓
   [Next Step - Use Merged Results]
```

### API Rate-Limited Fetches (Loops)

Fetch 1000 items from an API with low rate limits.

```
[API: Get Total Count] → result: 1000
    ↓
[DAG Loop]
  ├─ Source Field: items
  ├─ Batch Size: 10
  ├─ Max Iterations: 100
  │
  ├─[Loop Body]
  │   ↓
  │  [HTTP GET] with offset + limit
  │   ↓
  │  [Transform Result]
  │   ↓
  │  [repeat loop]
  │
  └─[Done] → [Combine All Results]
```

## Troubleshooting

### "DAG Join returns empty and never emits"

- Check `expectedBranchCount` matches `branchCount` in DAG Split
- Check all branches actually reach DAG Join (connection paths should be visible in n8n UI)
- Check `joinMode` — if `waitForAll`, ensure all branches complete

### "Loop runs forever"

- Set a `maxIterations` limit
- Use `breakCondition` to exit early
- Check source array is actually provided

### "Binary data is lost"

- This package preserves binary. If lost, check upstream nodes before DAG Split
- Ensure DAG Split is used as starting point if binary input is needed

## License

MIT

## Support

For issues, questions, or feature requests, visit the [GitHub repository](https://github.com/ksoftm/n8n-nodes-dag-orchestrator).

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
