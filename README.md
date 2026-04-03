<br>
<p align="center">
  <img src="https://raw.githubusercontent.com/n8n-io/n8n/master/assets/n8n-logo.png" alt="n8n logo" width="100">
</p>
<h1 align="center">n8n-nodes-dag-orchestrator</h1>
<p align="center">
  <b>A Blueprint-Style DAG (Directed Acyclic Graph) Workflow Orchestrator natively inside n8n.</b>
</p>
<p align="center">
  <a href="https://www.npmjs.com/package/@ksoftm/n8n-nodes-dag-orchestrator" target="_blank"><img src="https://img.shields.io/npm/v/@ksoftm/n8n-nodes-dag-orchestrator" alt="NPM Version"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://n8n.io"><img src="https://img.shields.io/badge/n8n-community%20node-blue?logo=n8n" alt="n8n Community Node"></a>
</p>

---

The DAG Orchestrator solves multiple simultaneous data pipelines within a single node avoiding n8n's visual bloat, manual looping indices, and missing dependency links. It allows you to run **parallel branches**, declare **dependencies**, and establish robust **try/catch** loops over arrays or inputs completely inside a unified interface.

## 📦 Installation

### From the n8n UI (Recommended)
1. In your n8n workspace, navigate to **Settings** > **Community Nodes**.
2. Click **Install Node**.
3. Type `@ksoftm/n8n-nodes-dag-orchestrator` and agree to the terms.
4. Restart your instance if running manually!

### From the command line
If you are running the docker image and using custom mounting boundaries, install via npm:
```bash
cd ~/.n8n/custom/
npm install @ksoftm/n8n-nodes-dag-orchestrator
```

## ✨ Key Features
* 🚀 **Concurrent Execution:** Run completely unlinked branches at the exact same time without visual sub-workflows.
* ⛓️ **Graph Resolution:** Specify `dependencies: ['branch_id_1']`. The engine (using Kahn's Topological rules) calculates precisely when child pipelines execute perfectly.
* 🛡️ **Native Try/Catch/Finally:** Configure specific fallback payload strategies instead of blowing up the parent workflow chain.
* 🔄 **Built-in Auto Retry:** Tell branches to inherently retry upon failure with automated backoff intervals.

## 🛠️ Usage Example

In the DAG Orchestrator `Branches Configuration (JSON)` parameter, provide your pipeline structure:

```json
[
  {
    "id": "storage",
    "name": "Image Storage",
    "dependencies": [],
    "dataType": "binary",
    "try": { "operation": "storeFile" },
    "timeout": 60000,
    "retry": { "maxAttempts": 3, "delayMs": 5000 }
  },
  {
    "id": "thumbnail",
    "name": "Generate Thumbnail",
    "dependencies": ["storage"],
    "dataType": "binary",
    "try": { "operation": "resize" },
    "catch": { "operation": "fallbackThumb" }
  }
]
```

## ⚙️ Risks and Edge Case Controls

| Risk | Impact | Automated Control Mitigation |
|---|---|---|
| **Circular Dependency** | Crashes execution threads indefinitely (A -> B -> A). | The orchestrator algorithm parses dependencies on trigger and securely throws a `Circular dependency detected` error before native payload locks apply. |
| **Silent Timeout Locking** | Unresponsive paths lock the entire DAG. | Set `timeout` boundaries explicitly on branches. The DAG will prune branches or `stopOnFirst` allowing n8n to continue reporting safely! |
| **Node Buffer Saturation** | Processing parallel binaries bloats standard execution memory. | Binaries traverse inside transient isolated Buffers via the internal `StateManager`. Scopes securely cleanup memory maps efficiently for Node.js GC. |

## 🤝 Compatibility
Developed natively against **n8n v1.x**. Requires **Node.js 18+** standards.
