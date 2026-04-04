import {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';

export class DagCatch implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'DAG Catch',
    name: 'dagCatch',
    icon: 'file:icon.svg',
    group: ['transform'],
    version: 1,
    description: 'Handle failures from a DAG Try block and optionally recover.',
    defaults: {
      name: 'DAG Catch',
    },
    inputs: ['main'],
    outputs: ['main'],
    properties: [
      {
        displayName: 'Recovery Mode',
        name: 'recoveryMode',
        type: 'options',
        options: [
          { name: 'fallback', value: 'fallback' },
          { name: 'rethrow', value: 'rethrow' },
        ],
        default: 'fallback',
        description: 'Use fallback data or rethrow the error upward.',
      },
      {
        displayName: 'Fallback Value',
        name: 'fallbackValue',
        type: 'json',
        default: {},
        description: 'Fallback JSON data to use when recovery mode is fallback.',
      },
      {
        displayName: 'Log Error',
        name: 'logError',
        type: 'boolean',
        default: true,
        description: 'Whether to include error details in the output item.',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const recoveryMode = this.getNodeParameter('recoveryMode', 0) as string;
    const fallbackValue = this.getNodeParameter('fallbackValue', 0) as Record<string, any>;
    const logError = this.getNodeParameter('logError', 0) as boolean;
    const items = this.getInputData();

    const outputItems = items.map((item) => {
      const baseJson: Record<string, any> = {
        ...item.json,
      };

      if (recoveryMode === 'fallback') {
        baseJson._dagStatus = 'catch_recovered';
        baseJson._dagFallbackData = fallbackValue;
        if (logError && item.json._dagError) {
          baseJson._dagError = item.json._dagError;
        }
      } else {
        baseJson._dagStatus = 'catch_failed';
        if (logError && item.json._dagError) {
          baseJson._dagError = item.json._dagError;
        }
      }

      return {
        json: baseJson,
        binary: item.binary,
        pairedItem: item.pairedItem,
      } as INodeExecutionData;
    });

    if (recoveryMode === 'rethrow') {
      throw new Error('DAG Catch configured to rethrow failures.');
    }

    return [outputItems];
  }
}
