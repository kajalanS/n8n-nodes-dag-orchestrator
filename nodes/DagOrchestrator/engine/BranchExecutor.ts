import { INodeExecutionData } from 'n8n-workflow';
import { IBranch } from '../types/Branch.types';
import { StateManager } from './StateManager';

export class BranchExecutor {
  private stateManager: StateManager;
  private evaluateExpression?: (expression: any) => any;

  constructor(stateManager: StateManager, evaluateExpression?: (expression: any) => any) {
    this.stateManager = stateManager;
    this.evaluateExpression = evaluateExpression;
  }

  public async executeBranch(branch: IBranch, inputData: INodeExecutionData[]): Promise<INodeExecutionData[]> {
    this.stateManager.setBranchStatus(branch.id, 'running');
    this.stateManager.addLogEntry({ branchId: branch.id, event: 'started' });

    const maxAttempts = branch.retry?.maxAttempts ?? 1;
    const delayMs = branch.retry?.delayMs ?? 1000;

    let attempt = 0;
    let success = false;
    let lastError: Error | null = null;
    let resultData: INodeExecutionData[] = [];

    while (attempt < maxAttempts && !success) {
      attempt++;
      try {
        if (branch.timeout) {
          resultData = await this.executeWithTimeout(branch.try, inputData, branch.timeout);
        } else {
          resultData = await this.executeOperation(branch.try, inputData);
        }
        success = true;
      } catch (error: any) {
        // Determine if we should retry based on status codes and branch config
        const status: number | undefined = error?.statusCode;
        let shouldRetry = true;
        if (status !== undefined) {
          if (status >= 400 && status < 500) {
            shouldRetry = branch.retry?.retryOn4xx ?? false;
          } else if (status >= 500 && status < 600) {
            shouldRetry = branch.retry?.retryOn5xx ?? true;
          }
        }
        lastError = error;
        this.stateManager.addLogEntry({
          branchId: branch.id,
          event: `try_failed_attempt_${attempt}`,
          message: error.message,
        });

        if (!shouldRetry) {
          // Do not attempt further retries for this error
          break;
        }
        if (attempt < maxAttempts && shouldRetry) {
          const backoff: any = branch.retry?.backoff ?? 'none';
          const baseDelay = branch.retry?.delayMs ?? delayMs;
          let wait = baseDelay;
          if (backoff === 'linear') {
            wait = baseDelay * attempt;
          } else if (backoff === 'exponential') {
            wait = baseDelay * Math.pow(2, attempt - 1);
          }
          await this.sleep(wait);
        }
      }
    }

    if (!success && branch.catch) {
      this.stateManager.addLogEntry({ branchId: branch.id, event: 'running_catch' });
      try {
        resultData = await this.executeOperation(branch.catch, inputData);
        success = true; // Recovered in catch
      } catch (catchError: any) {
        lastError = catchError;
        this.stateManager.addLogEntry({
          branchId: branch.id,
          event: 'catch_failed',
          message: catchError.message,
        });
      }
    }

    if (branch.finally) {
      this.stateManager.addLogEntry({ branchId: branch.id, event: 'running_finally' });
      try {
        await this.executeOperation(branch.finally, inputData);
      } catch (finallyError: any) {
        this.stateManager.addLogEntry({
          branchId: branch.id,
          event: 'finally_failed',
          message: finallyError.message,
        });
      }
    }

    if (success) {
      this.stateManager.setBranchStatus(branch.id, 'success');
      this.stateManager.setBranchResult(branch.id, resultData);
      this.stateManager.addLogEntry({ branchId: branch.id, event: 'completed' });
      return resultData;
    } else {
      this.stateManager.setBranchStatus(branch.id, 'failed');
      this.stateManager.addLogEntry({ branchId: branch.id, event: 'failed_terminal', message: lastError?.message });
      this.stateManager.addError({ branchId: branch.id, message: lastError?.message || 'Unknown error', details: lastError });
      throw lastError; // Throw up to DagEngine
    }
  }

  private async executeWithTimeout(operation: any, inputData: INodeExecutionData[], timeoutMs: number): Promise<INodeExecutionData[]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      this.executeOperation(operation, inputData).then(
        (res) => { clearTimeout(timer); resolve(res); },
        (err) => { clearTimeout(timer); reject(err); }
      );
    });
  }

  private async executeOperation(operation: any, inputData: INodeExecutionData[]): Promise<INodeExecutionData[]> {
    // Deep-evaluate any string fields that start with '=' using evaluateExpression
    const deepEvaluate = (obj: any): any => {
      if (obj === null || obj === undefined) return obj;
      if (typeof obj === 'string') {
        if (obj.startsWith('=') && this.evaluateExpression) {
          try {
            return this.evaluateExpression(obj);
          } catch (e: any) {
            this.stateManager.addLogEntry({ branchId: '', event: 'eval_error', message: e.message });
            return null;
          }
        }
        return obj;
      }
      if (Array.isArray(obj)) return obj.map(deepEvaluate);
      if (typeof obj === 'object') {
        const out: any = {};
        for (const k of Object.keys(obj)) {
          out[k] = deepEvaluate(obj[k]);
        }
        return out;
      }
      return obj;
    };

    const evaluatedOperation = deepEvaluate(operation);

    // For tests and controlled failures: support operation strings like 'throw:500' or 'throw:400'
    if (typeof evaluatedOperation.operation === 'string' && evaluatedOperation.operation.startsWith('throw:')) {
      const parts = (evaluatedOperation.operation as string).split(':');
      const code = parseInt(parts[1], 10) || 500;
      const err: any = new Error(`simulated ${code}`);
      err.statusCode = code;
      throw err;
    }

    // Handle binary write/read operations if present
    if (evaluatedOperation.binaryWrite) {
      const write = evaluatedOperation.binaryWrite;
      const id = write.id as string;
      let data = write.data;
      if (typeof data === 'string') {
        // assume base64 string
        try {
          const buf = Buffer.from(data, 'base64');
          this.stateManager.setBinaryBuffer(id, buf);
        } catch (e) {
          this.stateManager.addLogEntry({ branchId: '', event: 'binary_write_error', message: (e as any).message });
        }
      }
      return Promise.resolve([{ json: { ...inputData[0]?.json, operationExecuted: evaluatedOperation.operation, binaryStored: id } }]);
    }

    if (evaluatedOperation.binaryRead) {
      const id = evaluatedOperation.binaryRead as string;
      const buf = this.stateManager.getBinaryBuffer(id);
      const base64 = buf ? buf.toString('base64') : null;
      return Promise.resolve([{ json: { ...inputData[0]?.json, operationExecuted: evaluatedOperation.operation, binary: base64 } }]);
    }

    return Promise.resolve([{ json: { ...inputData[0]?.json, operationExecuted: evaluatedOperation.operation } }]);
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
