import { INodeExecutionData } from 'n8n-workflow';
import { IExecutionState, BranchStatus, IExecutionLogEntry, ILoopState, IExecutionError } from '../types/State.types';

export class StateManager {
  private state: IExecutionState;

  constructor() {
    this.state = {
      branchResults: new Map<string, INodeExecutionData[]>(),
      branchStatus: new Map<string, BranchStatus>(),
      binaryBuffers: new Map<string, Buffer>(),
      executionLog: [],
      errors: []
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

  public addError(entry: Omit<IExecutionError, 'timestamp'>): void {
    this.state.errors.push({ ...entry, timestamp: new Date().toISOString() });
  }

  public getErrors(): IExecutionError[] {
    return this.state.errors;
  }

  public getExecutionLog(): IExecutionLogEntry[] {
    return this.state.executionLog;
  }

  public setBinaryBuffer(id: string, buf: Buffer): void {
    this.state.binaryBuffers.set(id, buf);
  }

  public getBinaryBuffer(id: string): Buffer | undefined {
    return this.state.binaryBuffers.get(id);
  }

  public removeBinaryBuffer(id: string): void {
    this.state.binaryBuffers.delete(id);
  }

  public getAllBinaryBuffers(): Map<string, Buffer> {
    return this.state.binaryBuffers;
  }
}
