import { INodeExecutionData } from 'n8n-workflow';
import { IDagConfig } from '../types/Dag.types';
import { StateManager } from './StateManager';
import { DependencyResolver } from './DependencyResolver';
import { BranchExecutor } from './BranchExecutor';
import { LoopController } from './LoopController';
import { IBranch } from '../types/Branch.types';

export class DagEngine {
  private config: IDagConfig;
  private stateManager: StateManager;
  private dependencyResolver: DependencyResolver;
  private branchExecutor: BranchExecutor;
  private loopController: LoopController;
  private evaluateExpression?: (expression: any) => any;

  constructor(config: IDagConfig, evaluateExpression?: (expression: any) => any) {
    this.config = config;
    this.stateManager = new StateManager();
    this.dependencyResolver = new DependencyResolver();
    this.evaluateExpression = evaluateExpression;
    this.branchExecutor = new BranchExecutor(this.stateManager, evaluateExpression);
    this.loopController = new LoopController();
  }

  public async execute(inputData: INodeExecutionData[]): Promise<INodeExecutionData[]> {
    const { orderedBranches, adjacencyList, incomingEdgesCount } = this.dependencyResolver.resolveDependencies(this.config.branches);

    const branchCount = orderedBranches.length;
    const executePromises: Map<string, Promise<void>> = new Map();

    for (const branch of orderedBranches) {
      this.stateManager.setBranchStatus(branch.id, 'pending');
    }

    return new Promise((resolve, reject) => {
      let completedCount = 0;
      let hasFailed = false;
      let done = false;
      let globalTimedOut = false;
      let globalTimer: NodeJS.Timeout | undefined;

      const finishResolve = (err?: any) => {
        if (done) return;
        done = true;
        if (globalTimer) clearTimeout(globalTimer);
        if (err) reject(err); else resolve(this.mergeOutputs());
      };

      if (this.config.globalTimeout && this.config.globalTimeout > 0) {
        globalTimer = setTimeout(() => {
          globalTimedOut = true;
          this.stateManager.addLogEntry({ branchId: '', event: 'global_timeout', message: `Global timeout ${this.config.globalTimeout}ms` });
          if (this.config.errorStrategy === 'stopOnFirst') {
            finishResolve(new Error('Global timeout'));
            return;
          }
          // Mark pending branches as skipped
          for (const branch of orderedBranches) {
            if (this.stateManager.getBranchStatus(branch.id) === 'pending') {
              this.stateManager.setBranchStatus(branch.id, 'skipped');
              this.stateManager.addLogEntry({ branchId: branch.id, event: 'skipped_global_timeout' });
              completedCount++;
            }
          }
          finishResolve();
        }, this.config.globalTimeout);
      }

      const checkCompletion = (lastBranchId?: string, lastStatus?: string) => {
        if (done) return;
        if (hasFailed && this.config.errorStrategy === 'stopOnFirst') return;

        // joinMode: waitForFirst => resolve on first successful branch
        if (this.config.joinMode === 'waitForFirst' && lastStatus === 'success') {
          // mark others skipped
          for (const branch of orderedBranches) {
            if (this.stateManager.getBranchStatus(branch.id) === 'pending') {
              this.stateManager.setBranchStatus(branch.id, 'skipped');
              this.stateManager.addLogEntry({ branchId: branch.id, event: 'skipped_by_join_waitForFirst' });
            }
          }
          finishResolve();
          return;
        }

        // joinMode: waitForAny => resolve on first terminal branch (success/failed/skipped)
        if (this.config.joinMode === 'waitForAny' && lastStatus && ['success', 'failed', 'skipped', 'timeout'].includes(lastStatus)) {
          finishResolve();
          return;
        }

        if (completedCount === branchCount) {
          finishResolve();
        } else {
          scheduleNext();
        }
      };

      const runBranch = async (branch: IBranch) => {
        try {
          // Gather input from dependencies
          let combinedInput = [...inputData];
          for (const dep of branch.dependencies) {
            const depOut = this.stateManager.getBranchResult(dep) || [];
            combinedInput = combinedInput.concat(depOut);
          }

          // If branch has loop config, run per-item
          if (branch.loop && branch.loop.source) {
            let source = branch.loop.source;
            // If evaluator available, try to evaluate source items if expressions
            if (this.evaluateExpression) {
              try {
                // allow source to be an expression string
                if ((source as any).startsWith && (source as any).startsWith('=')) {
                  source = this.evaluateExpression(source);
                }
              } catch (e) {
                // ignore
              }
            }

            this.loopController.initializeLoop(branch.id, source as INodeExecutionData[]);
            const batchSize = branch.loop.batchSize && branch.loop.batchSize > 0 ? branch.loop.batchSize : 1;
            const workers: Promise<void>[] = [];

            const processNext = async (): Promise<void> => {
              const item = this.loopController.getNextItem(branch.id);
              if (!item) return;
              const loopStateForCtx = this.loopController.getLoopState(branch.id)!;
              const currentIndex = loopStateForCtx.currentIndex - 1;
              const total = loopStateForCtx.totalItems;
              // Evaluate continueCondition if provided
              const contCond = branch.loop?.continueCondition;
              let shouldContinue = true;
              if (typeof contCond === 'function') {
                try { shouldContinue = Boolean(contCond({ item, index: currentIndex, total })); } catch { shouldContinue = true; }
              } else if (typeof contCond === 'string' && contCond.startsWith('=') && this.evaluateExpression) {
                try { shouldContinue = Boolean(this.evaluateExpression(contCond)); } catch { shouldContinue = true; }
              }

              if (!shouldContinue) {
                // skip this item
                await processNext();
                return;
              }

              const iterInput = [item].concat(combinedInput);
              try {
                const iterResult = await this.branchExecutor.executeBranch(branch, iterInput);
                // check if a break was triggered with a lower index before storing
                const postLoopState = this.loopController.getLoopState(branch.id)!;
                if (typeof postLoopState.breakIndex === 'number' && currentIndex > postLoopState.breakIndex) {
                  // skip storing this result because a break occurred earlier
                } else {
                  // store per-iteration result with index
                  this.loopController.storeResult(branch.id, iterResult || [], currentIndex);
                }
                // Evaluate breakCondition after execution
                const breakCond = branch.loop?.breakCondition;
                let shouldBreak = false;
                if (typeof breakCond === 'function') {
                  try { shouldBreak = Boolean(breakCond({ item, index: currentIndex, total })); } catch { shouldBreak = false; }
                } else if (typeof breakCond === 'string' && breakCond.startsWith('=') && this.evaluateExpression) {
                  try { shouldBreak = Boolean(this.evaluateExpression(breakCond)); } catch { shouldBreak = false; }
                }
                if (shouldBreak) {
                  this.loopController.breakLoop(branch.id, currentIndex);
                  return;
                }
                // continue processing next item
                await processNext();
              } catch (e) {
                // error handling relies on BranchExecutor/DagEngine strategies
                if (this.config.errorStrategy === 'stopOnFirst') throw e;
                await processNext();
              }
            };

            for (let i = 0; i < batchSize; i++) {
              workers.push(processNext());
            }

            await Promise.all(workers);

            const loopState = this.loopController.getLoopState(branch.id);
            let resultsArr: INodeExecutionData[] = [];
            if (loopState) {
              const entries = loopState.accumulatedResults || [];
              // filter by breakIndex if present
              const bidx = loopState.breakIndex;
              const filtered = typeof bidx === 'number' ? entries.filter(e => e.index <= bidx) : entries;
              // sort by index to preserve original order
              filtered.sort((a, b) => a.index - b.index);
              resultsArr = filtered.flatMap(e => e.result);
            }
            this.stateManager.setBranchResult(branch.id, resultsArr);
            this.stateManager.setBranchStatus(branch.id, 'success');
            this.stateManager.addLogEntry({ branchId: branch.id, event: 'loop_completed' });
            completedCount++;
          } else {
            await this.branchExecutor.executeBranch(branch, combinedInput);
            completedCount++;
          }

          // Decrement pending counts for children
          const children = adjacencyList.get(branch.id) || [];
          for (const childId of children) {
            incomingEdgesCount.set(childId, incomingEdgesCount.get(childId)! - 1);
          }

          checkCompletion(branch.id, this.stateManager.getBranchStatus(branch.id));
        } catch (error) {
          this.stateManager.setBranchStatus(branch.id, 'failed');
          completedCount++;

          if (this.config.errorStrategy === 'stopOnFirst') {
            hasFailed = true;
            finishResolve(error);
          } else {
            // For continueOnError or collectErrors, we mark as failed and skip its children
            const cancelChildren = (id: string) => {
              const kids = adjacencyList.get(id) || [];
              for (const kid of kids) {
                if (this.stateManager.getBranchStatus(kid) === 'pending') {
                  this.stateManager.setBranchStatus(kid, 'skipped');
                  completedCount++;
                  cancelChildren(kid);
                }
              }
            };
            cancelChildren(branch.id);
            checkCompletion(branch.id, this.stateManager.getBranchStatus(branch.id));
          }
        }
      };

      const scheduleNext = () => {
        if (hasFailed && this.config.errorStrategy === 'stopOnFirst') return;

        const evaluateCondition = (branch: IBranch): boolean => {
          const cond = branch.condition;
          if (!cond) return true;
          // allSucceeded: every listed branch must have status 'success'
          if (cond.allSucceeded && Array.isArray(cond.allSucceeded)) {
            for (const id of cond.allSucceeded) {
              if (this.stateManager.getBranchStatus(id) !== 'success') return false;
            }
          }
          // anySucceeded: at least one listed branch must have status 'success'
          if (cond.anySucceeded && Array.isArray(cond.anySucceeded)) {
            let any = false;
            for (const id of cond.anySucceeded) {
              if (this.stateManager.getBranchStatus(id) === 'success') { any = true; break; }
            }
            if (!any) return false;
          }

          // expression: optional evaluator string like '={{$json.value}} > 0'
          if ((cond as any).expression !== undefined) {
            const expr = (cond as any).expression;
            if (typeof expr === 'boolean') return expr;
            if (typeof expr === 'string') {
              if (expr.startsWith('=') && this.evaluateExpression) {
                try {
                  const res = this.evaluateExpression(expr);
                  return Boolean(res);
                } catch (e: any) {
                  this.stateManager.addLogEntry({ branchId: branch.id, event: 'condition_eval_error', message: e.message });
                  return false;
                }
              } else {
                // No evaluator provided or not an expression string — cannot evaluate safely
                this.stateManager.addLogEntry({ branchId: branch.id, event: 'condition_no_evaluator', message: 'No evaluateExpression available for condition.expression' });
                return false;
              }
            }
          }
          return true;
        };

        for (const branch of orderedBranches) {
          if (this.stateManager.getBranchStatus(branch.id) === 'pending' && incomingEdgesCount.get(branch.id) === 0) {
            // Evaluate entry condition before scheduling
            if (!evaluateCondition(branch)) {
              this.stateManager.setBranchStatus(branch.id, 'skipped');
              this.stateManager.addLogEntry({ branchId: branch.id, event: 'skipped_condition' });
              completedCount++;
              // Unblock children of the skipped branch
              const children = adjacencyList.get(branch.id) || [];
              for (const childId of children) {
                incomingEdgesCount.set(childId, incomingEdgesCount.get(childId)! - 1);
              }
              checkCompletion();
              continue;
            }

            if (!executePromises.has(branch.id)) {
              let promise = runBranch(branch);
              executePromises.set(branch.id, promise);

              if (this.config.executionMode === 'sequential') {
                // Sequential mode waits for this one before scheduling more
                promise.then(() => { }).catch(() => { });
                break;
              }
            }
          }
        }
      };

      // Kick off initial branches
      scheduleNext();

      // If there are no branches
      if (branchCount === 0) {
        resolve(inputData);
      }
    });
  }

  private mergeOutputs(): INodeExecutionData[] {
    if (this.config.outputFormat === 'passthrough') {
      return []; // Would return the original input
    }

    let merged: any = {};
    for (const [id, results] of this.stateManager.getAllResults().entries()) {
      merged[id] = results.map(r => r.json);
    }

    // If collectErrors strategy is set, include errors array
    if (this.config.errorStrategy === 'collectErrors') {
      const errors = this.stateManager.getErrors();
      merged['errors'] = errors;
      const log = this.stateManager.getExecutionLog();
      merged['executionLog'] = log;
    }

    if (this.config.outputFormat === 'merged') {
      return [{ json: merged }];
    } else {
      // Array format
      return Object.keys(merged).map(key => ({ json: { branchId: key, data: merged[key] } }));
    }
  }
}
