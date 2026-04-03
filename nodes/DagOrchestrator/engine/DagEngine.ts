import { INodeExecutionData } from 'n8n-workflow';
import { IDagConfig } from '../types/Dag.types';
import { StateManager } from './StateManager';
import { DependencyResolver } from './DependencyResolver';
import { BranchExecutor } from './BranchExecutor';
import { IBranch } from '../types/Branch.types';

export class DagEngine {
	private config: IDagConfig;
	private stateManager: StateManager;
	private dependencyResolver: DependencyResolver;
	private branchExecutor: BranchExecutor;

	constructor(config: IDagConfig) {
		this.config = config;
		this.stateManager = new StateManager();
		this.dependencyResolver = new DependencyResolver();
		this.branchExecutor = new BranchExecutor(this.stateManager);
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

			const checkCompletion = () => {
				if (hasFailed && this.config.errorStrategy === 'stopOnFirst') return;
				if (completedCount === branchCount) {
					// All done, merge outputs based on outputFormat
					resolve(this.mergeOutputs());
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

					await this.branchExecutor.executeBranch(branch, combinedInput);
					completedCount++;

					// Decrement pending counts for children
					const children = adjacencyList.get(branch.id) || [];
					for (const childId of children) {
						incomingEdgesCount.set(childId, incomingEdgesCount.get(childId)! - 1);
					}

					checkCompletion();
				} catch (error) {
					this.stateManager.setBranchStatus(branch.id, 'failed');
					completedCount++;
					
					if (this.config.errorStrategy === 'stopOnFirst') {
						hasFailed = true;
						reject(error);
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
						checkCompletion();
					}
				}
			};

			const scheduleNext = () => {
				if (hasFailed && this.config.errorStrategy === 'stopOnFirst') return;

				for (const branch of orderedBranches) {
					if (this.stateManager.getBranchStatus(branch.id) === 'pending' && incomingEdgesCount.get(branch.id) === 0) {
						if (!executePromises.has(branch.id)) {
							let promise = runBranch(branch);
							executePromises.set(branch.id, promise);
							
							if (this.config.executionMode === 'sequential') {
								// Sequential mode waits for this one before scheduling more
								promise.then(() => {}).catch(() => {});
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

		if (this.config.outputFormat === 'merged') {
			return [{ json: merged }];
		} else {
			// Array format
			return Object.keys(merged).map(key => ({ json: { branchId: key, data: merged[key] } }));
		}
	}
}
