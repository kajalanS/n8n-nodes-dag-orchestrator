import { INodeExecutionData } from 'n8n-workflow';
import { IBranch } from '../types/Branch.types';
import { StateManager } from './StateManager';

export class BranchExecutor {
	private stateManager: StateManager;

	constructor(stateManager: StateManager) {
		this.stateManager = stateManager;
	}

	public async executeBranch(branch: IBranch, inputData: INodeExecutionData[]): Promise<void> {
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
				lastError = error;
				this.stateManager.addLogEntry({
					branchId: branch.id,
					event: `try_failed_attempt_${attempt}`,
					message: error.message,
				});

				if (attempt < maxAttempts) {
					await this.sleep(delayMs * attempt); // Simple linear backoff stub
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
		} else {
			this.stateManager.setBranchStatus(branch.id, 'failed');
			this.stateManager.addLogEntry({ branchId: branch.id, event: 'failed_terminal', message: lastError?.message });
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
		// In a real n8n node, this would evaluate an expression or call an external service
		return Promise.resolve([{ json: { ...inputData[0]?.json, operationExecuted: operation.operation } }]);
	}

	private async sleep(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}
