import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { DagEngine } from './engine/DagEngine';
import { IDagConfig } from './types/Dag.types';

export class DagOrchestrator implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'DAG Orchestrator',
		name: 'dagOrchestrator',
		icon: 'file:icon.svg',
		group: ['transform'],
		version: 1,
		description: 'Blueprint-Style DAG Workflow Orchestrator for n8n',
		defaults: {
			name: 'DAG Orchestrator',
		},
		inputs: ['main'],
		outputs: ['main'],
		properties: [
			{
				displayName: 'Execution Mode',
				name: 'executionMode',
				type: 'options',
				options: [
					{ name: 'Parallel', value: 'parallel' },
					{ name: 'Sequential', value: 'sequential' },
				],
				default: 'parallel',
				description: 'Whether to execute independent branches concurrently or one by one.',
			},
			{
				displayName: 'Join Mode',
				name: 'joinMode',
				type: 'options',
				options: [
					{ name: 'Wait For All', value: 'waitForAll' },
					{ name: 'Wait For First', value: 'waitForFirst' },
					{ name: 'Wait For Any', value: 'waitForAny' },
				],
				default: 'waitForAll',
			},
			{
				displayName: 'Output Format',
				name: 'outputFormat',
				type: 'options',
				options: [
					{ name: 'Merged Object', value: 'merged' },
					{ name: 'Array of Results', value: 'array' },
					{ name: 'Passthrough Output', value: 'passthrough' },
				],
				default: 'merged',
			},
			{
				displayName: 'Error Strategy',
				name: 'errorStrategy',
				type: 'options',
				options: [
					{ name: 'Stop On First Failure', value: 'stopOnFirst' },
					{ name: 'Continue On Error', value: 'continueOnError' },
					{ name: 'Collect Errors at End', value: 'collectErrors' },
				],
				default: 'stopOnFirst',
			},
			{
				displayName: 'Global Timeout (ms)',
				name: 'globalTimeout',
				type: 'number',
				default: 60000,
			},
			{
				displayName: 'Branches Configuration (JSON)',
				name: 'branchesConfig',
				type: 'json',
				default: '[\n  {\n    "id": "branch_1",\n    "name": "Example Branch",\n    "dependencies": [],\n    "dataType": "json",\n    "try": { "operation": "example" }\n  }\n]',
				description: 'Provide the DAG branch configuration as a JSON array.',
				required: true,
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();

		const executionMode = this.getNodeParameter('executionMode', 0) as 'parallel' | 'sequential';
		const joinMode = this.getNodeParameter('joinMode', 0) as 'waitForAll' | 'waitForFirst' | 'waitForAny';
		const outputFormat = this.getNodeParameter('outputFormat', 0) as 'merged' | 'array' | 'passthrough';
		const errorStrategy = this.getNodeParameter('errorStrategy', 0) as 'stopOnFirst' | 'continueOnError' | 'collectErrors';
		const globalTimeout = this.getNodeParameter('globalTimeout', 0) as number;
		const branchesConfigString = this.getNodeParameter('branchesConfig', 0) as string;

		let branches = [];
		try {
			branches = typeof branchesConfigString === 'string' ? JSON.parse(branchesConfigString) : branchesConfigString;
		} catch (e) {
			throw new Error('Invalid JSON provided for Branches Configuration.');
		}

		const config: IDagConfig = {
			executionMode,
			joinMode,
			outputFormat,
			errorStrategy,
			globalTimeout,
			branches,
		};

		const engine = new DagEngine(config);
		const result = await engine.execute(items);

		return [result];
	}
}
