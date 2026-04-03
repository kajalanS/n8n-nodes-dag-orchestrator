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
      let globalTimer: NodeJS.Timeout | undefined;

      const finishResolve = (err?: any) => {
        if (done) return;
        done = true;
        if (globalTimer) clearTimeout(globalTimer);
        if (err) return reject(err);
        return resolve(this.mergeOutputs());
      };

      if (this.config.globalTimeout && this.config.globalTimeout > 0) {
        globalTimer = setTimeout(() => {
          this.stateManager.addLogEntry({ branchId: '', event: 'global_timeout', message: `Global timeout ${this.config.globalTimeout}ms` });
          if (this.config.errorStrategy === 'stopOnFirst') {
            finishResolve(new Error('Global timeout'));
            return;
          }
          for (const b of orderedBranches) {
            if (this.stateManager.getBranchStatus(b.id) === 'pending') {
              this.stateManager.setBranchStatus(b.id, 'skipped');
              this.stateManager.addLogEntry({ branchId: b.id, event: 'skipped_global_timeout' });
              completedCount++;
            }
          }
          finishResolve();
        }, this.config.globalTimeout);
      }

      const evaluateCondition = (branch: IBranch): boolean => {
        const cond = branch.condition;
        if (!cond) return true;
        if (cond.allSucceeded && Array.isArray(cond.allSucceeded)) {
          for (const id of cond.allSucceeded) if (this.stateManager.getBranchStatus(id) !== 'success') return false;
        }
        if (cond.anySucceeded && Array.isArray(cond.anySucceeded)) {
          let any = false;
          for (const id of cond.anySucceeded) if (this.stateManager.getBranchStatus(id) === 'success') { any = true; break; }
          if (!any) return false;
        }
        if ((cond as any).expression !== undefined) {
          const expr = (cond as any).expression;
          if (typeof expr === 'boolean') return expr;
          if (typeof expr === 'string') {
            if (expr.startsWith('=') && this.evaluateExpression) {
              try { return Boolean(this.evaluateExpression(expr)); } catch (e: any) { this.stateManager.addLogEntry({ branchId: branch.id, event: 'condition_eval_error', message: e.message }); return false; }
            }
            this.stateManager.addLogEntry({ branchId: branch.id, event: 'condition_no_evaluator', message: 'No evaluateExpression available for condition.expression' });
            return false;
          }
        }
        return true;
      };

      const checkCompletion = (lastBranchId?: string, lastStatus?: string) => {
        if (done) return;
        if (hasFailed && this.config.errorStrategy === 'stopOnFirst') return;

        if (this.config.joinMode === 'waitForFirst' && lastStatus === 'success') {
          for (const b of orderedBranches) {
            if (this.stateManager.getBranchStatus(b.id) === 'pending') {
              this.stateManager.setBranchStatus(b.id, 'skipped');
              this.stateManager.addLogEntry({ branchId: b.id, event: 'skipped_by_join_waitForFirst' });
            }
          }
          finishResolve();
          return;
        }

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
          let combinedInput = [...inputData];
          for (const dep of branch.dependencies) {
            combinedInput = combinedInput.concat(this.stateManager.getBranchResult(dep) || []);
          }

          if (branch.group && branch.group.branches) {
            this.stateManager.addLogEntry({ branchId: branch.id, event: 'group_started' });
            const childConfig: IDagConfig = { ...this.config, branches: branch.group.branches, globalTimeout: branch.group.timeout } as IDagConfig;
            const childEngine = new DagEngine(childConfig, this.evaluateExpression);
            let childResult: INodeExecutionData[] = [];
            if (branch.group.timeout && branch.group.timeout > 0) {
              childResult = await Promise.race([
                childEngine.execute(combinedInput),
                new Promise<INodeExecutionData[]>((_, rej) => setTimeout(() => rej(new Error('Group timeout')), branch.group!.timeout)),
              ]);
            } else {
              childResult = await childEngine.execute(combinedInput);
            }
            this.stateManager.setBranchResult(branch.id, childResult);
            this.stateManager.setBranchStatus(branch.id, 'success');
            this.stateManager.addLogEntry({ branchId: branch.id, event: 'group_completed' });
            completedCount++;
            // unblock children
            const kids = adjacencyList.get(branch.id) || [];
            for (const kid of kids) incomingEdgesCount.set(kid, incomingEdgesCount.get(kid)! - 1);
            checkCompletion(branch.id, this.stateManager.getBranchStatus(branch.id));
            return;
          }

          if (branch.loop && branch.loop.source) {
            let source: any = branch.loop.source;
            if (this.evaluateExpression && typeof source === 'string' && source.startsWith('=')) {
              try { source = this.evaluateExpression(source); } catch { /* ignore */ }
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

              // continueCondition
              const contCond = branch.loop?.continueCondition;
              let shouldContinue = true;
              if (typeof contCond === 'function') { try { shouldContinue = Boolean(contCond({ item, index: currentIndex, total })); } catch { shouldContinue = true; } }
              else if (typeof contCond === 'string' && contCond.startsWith('=') && this.evaluateExpression) { try { shouldContinue = Boolean(this.evaluateExpression(contCond)); } catch { shouldContinue = true; } }
              if (!shouldContinue) { await processNext(); return; }

              const iterInput = [item].concat(combinedInput);
              try {
                const iterResult = await this.branchExecutor.executeBranch(branch, iterInput);
                const postLoopState = this.loopController.getLoopState(branch.id)!;
                if (typeof postLoopState.breakIndex !== 'number' || currentIndex <= postLoopState.breakIndex) {
                  this.loopController.storeResult(branch.id, iterResult || [], currentIndex);
                }
                // breakCondition
                const breakCond = branch.loop?.breakCondition;
                let shouldBreak = false;
                if (typeof breakCond === 'function') { try { shouldBreak = Boolean(breakCond({ item, index: currentIndex, total })); } catch { shouldBreak = false; } }
                else if (typeof breakCond === 'string' && breakCond.startsWith('=') && this.evaluateExpression) { try { shouldBreak = Boolean(this.evaluateExpression(breakCond)); } catch { shouldBreak = false; } }
                if (shouldBreak) { this.loopController.breakLoop(branch.id, currentIndex); return; }
                await processNext();
              } catch (e) {
                if (this.config.errorStrategy === 'stopOnFirst') throw e;
                await processNext();
              }
            };

            for (let i = 0; i < batchSize; i++) workers.push(processNext());
            await Promise.all(workers);

            const loopState = this.loopController.getLoopState(branch.id);
            let resultsArr: INodeExecutionData[] = [];
            if (loopState) {
              const entries = loopState.accumulatedResults || [];
              const bidx = loopState.breakIndex;
              const filtered = typeof bidx === 'number' ? entries.filter(e => e.index <= bidx) : entries;
              filtered.sort((a, b) => a.index - b.index);
              resultsArr = filtered.flatMap(e => e.result);
            }
            this.stateManager.setBranchResult(branch.id, resultsArr);
            this.stateManager.setBranchStatus(branch.id, 'success');
            this.stateManager.addLogEntry({ branchId: branch.id, event: 'loop_completed' });
            completedCount++;
            const kids = adjacencyList.get(branch.id) || [];
            for (const kid of kids) incomingEdgesCount.set(kid, incomingEdgesCount.get(kid)! - 1);
            checkCompletion(branch.id, this.stateManager.getBranchStatus(branch.id));
            return;
          }

          // Normal branch
          await this.branchExecutor.executeBranch(branch, combinedInput);
          completedCount++;
          const kids = adjacencyList.get(branch.id) || [];
          for (const kid of kids) incomingEdgesCount.set(kid, incomingEdgesCount.get(kid)! - 1);
          checkCompletion(branch.id, this.stateManager.getBranchStatus(branch.id));

        } catch (error) {
          this.stateManager.setBranchStatus(branch.id, 'failed');
          completedCount++;
          if (this.config.errorStrategy === 'stopOnFirst') {
            hasFailed = true;
            finishResolve(error);
            return;
          }
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
      };

      const scheduleNext = () => {
        if (hasFailed && this.config.errorStrategy === 'stopOnFirst') return;
        for (const branch of orderedBranches) {
          if (this.stateManager.getBranchStatus(branch.id) === 'pending' && incomingEdgesCount.get(branch.id) === 0) {
            if (!evaluateCondition(branch)) {
              this.stateManager.setBranchStatus(branch.id, 'skipped');
              this.stateManager.addLogEntry({ branchId: branch.id, event: 'skipped_condition' });
              completedCount++;
              const children = adjacencyList.get(branch.id) || [];
              for (const c of children) incomingEdgesCount.set(c, incomingEdgesCount.get(c)! - 1);
              checkCompletion();
              continue;
            }
            if (!executePromises.has(branch.id)) {
              const p = runBranch(branch);
              executePromises.set(branch.id, p);
              if (this.config.executionMode === 'sequential') { p.then(() => { }).catch(() => { }); break; }
            }
          }
        }
      };

      // start
      scheduleNext();
      if (branchCount === 0) resolve(inputData);
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
