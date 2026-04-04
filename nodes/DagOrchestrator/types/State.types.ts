import { INodeExecutionData } from 'n8n-workflow';

export type BranchStatus = 'pending' | 'running' | 'success' | 'failed' | 'timeout' | 'skipped';

export interface ILoopState {
  currentIndex: number;
  totalItems: number;
  items: INodeExecutionData[];
  accumulatedResults: { index: number; result: INodeExecutionData[] }[];
  breakIndex?: number;
}

export interface IExecutionLogEntry {
  timestamp: string;
  branchId: string;
  event: string;
  message?: string;
  details?: any;
}

export interface IExecutionError {
  branchId: string;
  message: string;
  details?: any;
  timestamp: string;
}

export interface IExecutionState {
  branchResults: Map<string, INodeExecutionData[]>;
  branchStatus: Map<string, BranchStatus>;
  binaryBuffers: Map<string, Buffer>;
  executionLog: IExecutionLogEntry[];
  errors: IExecutionError[];
}
