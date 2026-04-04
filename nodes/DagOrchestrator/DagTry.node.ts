import {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';

export class DagTry implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'DAG Try',
    name: 'dagTry',
    icon: 'file:icon.svg',
    group: ['transform'],
    version: 1,
    description: 'Start a try block on a branch and route failures to the failure output',
    defaults: {
      name: 'DAG Try',
    },
    inputs: ['main'],
    outputs: ['main', 'main'],
    properties: [
      {
        displayName: 'Branch Label',
        name: 'branchLabel',
        type: 'string',
        default: 'branch_1',
        description: 'Identifier for this branch. Must be unique within the DAG flow.',
      },
      {
        displayName: 'Operation Label',
        name: 'operationLabel',
        type: 'string',
        default: 'My Operation',
        description: 'Human-readable name shown in execution logs.',
      },
      {
        displayName: 'Timeout (ms)',
        name: 'timeout',
        type: 'number',
        default: 0,
        description: '0 means no timeout. Any value > 0 wraps execution in a timer.',
      },
      {
        displayName: 'Max Retry Attempts',
        name: 'maxRetryAttempts',
        type: 'number',
        default: 1,
        description: '1 means no retry. Set higher to retry on failure.',
      },
      {
        displayName: 'Retry Delay (ms)',
        name: 'retryDelay',
        type: 'number',
        default: 1000,
        description: 'Delay between retry attempts.',
      },
      {
        displayName: 'Retry Backoff',
        name: 'retryBackoff',
        type: 'options',
        options: [
          { name: 'none', value: 'none' },
          { name: 'linear', value: 'linear' },
          { name: 'exponential', value: 'exponential' },
        ],
        default: 'none',
        description: 'Backoff strategy for retries.',
      },
      {
        displayName: 'Retry on 4xx Errors',
        name: 'retryOn4xxErrors',
        type: 'boolean',
        default: false,
      },
      {
        displayName: 'Retry on 5xx Errors',
        name: 'retryOn5xxErrors',
        type: 'boolean',
        default: true,
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    try {
      const branchLabel = this.getNodeParameter('branchLabel', 0) as string;
      const operationLabel = this.getNodeParameter('operationLabel', 0) as string;
      const itemsIn = this.getInputData();

      const successItems = itemsIn.map((item) => {
        return {
          json: {
            ...item.json,
            _dagBranchLabel: branchLabel,
            _dagOperationLabel: operationLabel,
            _dagStatus: 'try_running',
            _dagTimestamp: new Date().toISOString(),
          },
          binary: item.binary,
          pairedItem: item.pairedItem,
        } as INodeExecutionData;
      });

      return [successItems, []];
    } catch (error) {
      const itemsIn = this.getInputData();
      const failureItems = itemsIn.map((item) => {
        return {
          json: {
            ...item.json,
            _dagStatus: 'try_failed',
            _dagError: error instanceof Error ? error.message : String(error),
            _dagTimestamp: new Date().toISOString(),
          },
          binary: item.binary,
          pairedItem: item.pairedItem,
        } as INodeExecutionData;
      });
      return [[], failureItems];
    }
  }
}
