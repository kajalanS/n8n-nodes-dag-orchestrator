export type BackoffType = 'none' | 'linear' | 'exponential';
export type DataType = 'json' | 'binary' | 'mixed';

export interface IRetryConfig {
  maxAttempts: number;
  delayMs: number;
  backoff: BackoffType;
  // whether to retry on 4xx and 5xx HTTP-like errors
  retryOn4xx?: boolean;
  retryOn5xx?: boolean;
}

export interface IOperationConfig {
  operation: string;
  [key: string]: any;
}

export interface IConditionConfig {
  allSucceeded?: string[];
  anySucceeded?: string[];
  [key: string]: any;
}

export interface IBranch {
  id: string;
  name: string;
  dependencies: string[];
  condition?: IConditionConfig;
  loop?: {
    source?: any[]; // array of INodeExecutionData-like objects or expression
    batchSize?: number;
    indexVar?: string;
    totalVar?: string;
    breakCondition?: any;
    continueCondition?: any;
    maxIterations?: number;
  };
  dataType: DataType;
  try: IOperationConfig;
  catch?: IOperationConfig;
  finally?: IOperationConfig;
  timeout?: number;
  skipOnTimeout?: boolean;
  retry?: IRetryConfig;
}
