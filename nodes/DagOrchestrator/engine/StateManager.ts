import { INodeExecutionData } from 'n8n-workflow';
import { IExecutionState, BranchStatus, IExecutionLogEntry, ILoopState } from '../types/State.types';

export class StateManager {
	private state: IExecutionState;

	constructor() {
		this.state = {
			branchResults: new Map<string, INodeExecutionData[]>(),
			branchStatus: new Map<string, BranchStatus>(),
			binaryBuffers: new Map<string, Buffer>(),
			loopState: {},
			executionLog: []
		};
	}

	public setBranchStatus(branchId: string, status: BranchStatus): void {
		this.state.branchStatus.set(branchId, status);
	}

	public getBranchStatus(branchId: string): BranchStatus | undefined {
		return this.state.branchStatus.get(branchId);
	}

	public setBranchResult(branchId: string, data: INodeExecutionData[]): void {
		this.state.branchResults.set(branchId, data);
	}

	public getBranchResult(branchId: string): INodeExecutionData[] | undefined {
		return this.state.branchResults.get(branchId);
	}

	public addLogEntry(entry: Omit<IExecutionLogEntry, 'timestamp'>): void {
		this.state.executionLog.push({
			...entry,
			timestamp: new Date().toISOString()
		});
	}

	public getAllResults(): Map<string, INodeExecutionData[]> {
		return this.state.branchResults;
	}
	
	public getAllStatuses(): Map<string, BranchStatus> {
		return this.state.branchStatus;
	}
}
