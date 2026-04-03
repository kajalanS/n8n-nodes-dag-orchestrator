export type BackoffType = 'none' | 'linear' | 'exponential';
export type DataType = 'json' | 'binary' | 'mixed';

export interface IRetryConfig {
	maxAttempts: number;
	delayMs: number;
	backoff: BackoffType;
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
	dataType: DataType;
	try: IOperationConfig;
	catch?: IOperationConfig;
	finally?: IOperationConfig;
	timeout?: number;
	skipOnTimeout?: boolean;
	retry?: IRetryConfig;
}
