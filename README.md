# n8n-nodes-dag-orchestrator
![n8n](https://img.shields.io/badge/n8n-community%20node-blue?logo=n8n)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A Blueprint-Style DAG (Directed Acyclic Graph) Workflow Orchestrator for n8n. This community node allows you to run multiple workflow branches natively in parallel with sophisticated inter-dependency structures without needing sub-workflows or clunky index tracking!

## Key Features
- **Concurrent Parallel Execution:** Wait for overlapping endpoints simultaneously.
- **DAG Flow Mapping:** Provide simple dependent IDs to route flow chains automatically using robust topological mapping.
- **Native Context & Evaluation:** Evaluates expressions directly within your n8n workspace context.
- **Automated Fallbacks & Retries:** Contains `catch`, `finally`, and `retry/backoff` parameters per logic block, guaranteeing data extraction survival under latency conditions.

---

## Testing & Environment Controls

### Testing Locally in Native n8n Install
If you have n8n running directly on your machine via npm (`npm list -g n8n`):

1. **Build this node:**  
   Inside this repository folder, run:
   ```bash
   npm run build
   npm link
   ```
2. **Mount to your n8n configuration:**  
   Navigate to the `.n8n/custom/` repository in your home directory (create it if missing).
   ```bash
   cd ~/.n8n/custom/
   npm link @ksoftm/n8n-nodes-dag-orchestrator
   ```
3. **Restart n8n:**  
   Re-launch the `n8n` command. Your node will appear inside your local UI browser!

### Testing via Docker
Running n8n via a standard `docker-compose.yml` mapped configuration:

1. Under your compose configuration, bind mount this repository.
   ```yaml
   services:
     n8n:
       image: n8nio/n8n
       volumes:
         - /path/to/my/n8n-nodes-dag-orchestrator:/home/node/.n8n/custom/n8n-nodes-dag-orchestrator
   ```
2. Ensure you have run an initial `npm run build` on your host.
3. Restart your container `docker compose up -d`.

---

## Automated Deployment (CI/CD)

This repository enforces **NPM Provenance** natively. 
When you create a formal **Release** within GitHub, the GitHub Actions worker will run tests, compile `tsc`, and deploy dynamically to the public registry. 

**Requirements:** Set an Access Token in GitHub Secrets named `NPM_TOKEN`.

---

## Risks and Controls Strategy

When integrating custom workflow orchestrators, evaluating stability is incredibly important.

| Risk Identified | Impact Area | Mitigation & Implemented Control |
|---|---|---|
| **Infinite Recursion / Circular Dependency** | Can crash the physical node execution thread causing standard n8n workflows to freeze. | **Control:** Graph resolution relies on **Kahn's Algorithm** beforehand. It dynamically calculates edge dependencies and definitively blocks execution natively throwing "Circular Dependency Detected" if A -> B -> A is detected. |
| **Silent Failures Blocking Output Merge** | A dangling request out over HTTP that eventually times out but locks DAG promises indefinitely. | **Control:** Implement local execution boundaries. Set `timeout: 60000ms` for individual branches and a fallback handler. At worst, apply global `stopOnFirst` error strategies. |
| **Node Buffer Saturation (Memory Bloat)** | Orchestrator handles parallel heavy file processing (PDFs, Images, Video passing) retaining binaries globally causing RAM overloads. | **Control:** Each node receives an ephemeral, isolated `StateManager` buffer execution mapping. Once `DagEngine.execute()` completes its final merge loop, variables and isolated binary blobs fall out of scope for aggressive automatic Node.js Garbage Collection. |
| **Code Injection in n8n Evaluation Context** | Exposing `evaluateExpression()` inside arbitrary node routing parameters. | **Control:** No custom execution evaluators (e.g., node 'eval') are manually processed. We securely bind to n8n’s highly audited inner context handler exclusively. |

## Compatibility
`n8n >= v1.0.0`
`Node >= v18.0 (built for v22)`
