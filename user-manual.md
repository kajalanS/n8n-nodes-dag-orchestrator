# DAG Orchestrator — User Manual

Version: 1.0.0

## Overview

The `DAG Orchestrator` node provides a blueprint-style directed acyclic graph (DAG) orchestration primitive for n8n. Use it to model branches of work with explicit dependencies between branches and then execute them in parallel or sequentially with flexible join and error-handling strategies.

This manual explains installation, configuration, properties, examples, and troubleshooting steps (including icon issues).

## Installation

- Prerequisites: Node.js and npm installed.
- Clone or download this repository into a workspace on the machine where you run n8n.

1. Install dev dependencies and build the package:

```bash
npm install
npm run build
```

2. Install the built package into your n8n instance. There are two common approaches:

- Local install (recommended for development):

  - Copy the `dist` folder or the whole package into n8n's custom nodes folder (for example `~/.n8n/custom/`), or
  - From your n8n project run: `npm install /path/to/this/repo` and restart n8n.

- Publish and install (for distribution): publish the package to a registry and install it into the n8n host.

3. Restart n8n. The `DAG Orchestrator` node will appear in the node palette under the `Transform` group (display name: `DAG Orchestrator`).

Note about building assets: The TypeScript build compiles code to `dist/`. Icon assets (SVG) are copied to `dist/nodes/...` by the included post-build script, so you do not need to copy them manually if you used `npm run build`.

## Node Purpose & When to Use

- Orchestrating complex, branching workflows that have explicit dependencies.
- Running independent branches in parallel and combining results with different join semantics.
- Implementing retry/error aggregation strategies centrally before emitting final results downstream.

## Node Properties (UI)

- Execution Mode (`executionMode`): `Parallel` or `Sequential` — whether branches that have no unresolved dependencies should run concurrently or one-by-one.
- Join Mode (`joinMode`): `Wait For All`, `Wait For First`, or `Wait For Any` — controls when the orchestrator outputs results for a given input item.
- Output Format (`outputFormat`): `Merged Object`, `Array of Results`, or `Passthrough Output` — how branch outputs are combined.
- Error Strategy (`errorStrategy`): `Stop On First Failure`, `Continue On Error`, or `Collect Errors at End` — controls behavior when branches fail.
- Global Timeout (ms) (`globalTimeout`): Maximum time in milliseconds allowed for the orchestration to finish for one input item.
- Branches Configuration (JSON) (`branchesConfig`): A JSON array describing branches, their ids, names, dependencies, and the work to perform.

## `branchesConfig` schema (recommended)

Each branch is an object. Minimal example:

```json
[
  {
    "id": "branch_1",
    "name": "Load Data",
    "dependencies": [],
    "dataType": "json",
    "try": { "operation": "loadData" }
  },
  {
    "id": "branch_2",
    "name": "Process",
    "dependencies": ["branch_1"],
    "dataType": "json",
    "try": { "operation": "processData" }
  }
]
```

- `id` (string): Unique branch identifier.
- `name` (string): Human-friendly name shown in logs and debugging.
- `dependencies` (array of ids): Branches that must complete successfully (or according to the configured error strategy) before this branch runs.
- `dataType` (string): Describes the expected data shape (documentational only).
- `try` (object): A user-defined descriptor for what the branch does. The orchestrator itself does not inspect `try.operation` — it's intended for your engine or for debugging.

## Execution Model

1. The node receives one or more input items.
2. For each input item the engine builds the execution plan based on `branchesConfig`.
3. Branches whose dependencies are satisfied become eligible to run; they are scheduled according to `executionMode`.
4. Results are aggregated according to `outputFormat` and emitted downstream.

## Examples

- Parallel execution, wait for all results, merged output: good for fan-out/fan-in style workflows.
- Sequential execution, wait for each branch in order: good when ordering or resource constraints require serialization.

Example: simple two-branch parallel workflow — configure `executionMode`=`parallel`, `joinMode`=`waitForAll`, and `branchesConfig` similar to the schema above.

## Troubleshooting

- Icon not visible in node palette

  - Cause: The UI expects the icon file to be available at runtime under the node package's `dist` directory. If `icon.svg` isn't copied into `dist/nodes/DagOrchestrator/` the browser will show a broken image.
  - Fix: Ensure you built the package with `npm run build` (the build script copies SVG assets into `dist` automatically). If you manually copied files into n8n, make sure `icon.svg` is next to `DagOrchestrator.node.js` in the deployed folder.
  - Developer note: The node's description uses `icon: 'file:./icon.svg'` (relative path). Both the JS file and `icon.svg` must be deployed together into `dist/nodes/DagOrchestrator/`.

- Invalid JSON in `Branches Configuration`

  - Cause: The `branchesConfig` property expects valid JSON. The node will throw `Invalid JSON provided for Branches Configuration.` if parsing fails.
  - Fix: Validate JSON (e.g., use an online JSON linter) or compose the JSON in an upstream node that guarantees valid JSON output.

## Development tips

- Watch mode during development: `npm run dev`.
- Run unit tests: `npm test`.
- After changes run `npm run build` then restart n8n to pick up changes.

## Advanced

- Packaging for distribution: ensure `dist` is included in the published package (this repository's `package.json` already restricts `files` to `dist`).
- If adding additional assets (images, CSS), update `scripts/copy-assets.js` to include them.

## FAQ

- Q: Why does the node manifest list `dist/nodes/DagOrchestrator/DagOrchestrator.node.js`?
  - A: This points n8n at the compiled JavaScript entry file. The TypeScript sources live under `nodes/` and are compiled into `dist/nodes/` by the `tsc` step.

## Contact & Contributing

If you'd like to report issues or contribute, open an issue or PR in the repository. Include reproduction steps and, if possible, a minimal `branchesConfig` example.

---

Last updated: April 3, 2026
