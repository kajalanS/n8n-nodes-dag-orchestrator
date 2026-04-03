import { IBranch } from './Branch.types';

export type ExecutionMode = 'parallel' | 'sequential';
export type JoinMode = 'waitForAll' | 'waitForFirst' | 'waitForAny';
export type OutputFormat = 'merged' | 'array' | 'passthrough';
export type ErrorStrategy = 'stopOnFirst' | 'continueOnError' | 'collectErrors';

export interface IDagConfig {
	executionMode: ExecutionMode;
	joinMode: JoinMode;
	outputFormat: OutputFormat;
	globalTimeout?: number;
	errorStrategy: ErrorStrategy;
	branches: IBranch[];
}
