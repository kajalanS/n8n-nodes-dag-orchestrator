import {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';

export class DagSplit implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'DAG Split',
    name: 'dagSplit',
    icon: 'file:icon.svg',
    group: ['transform'],
    version: 1,
    description: 'Split input into up to six parallel DAG branches',
    defaults: {
      name: 'DAG Split',
    },
    inputs: ['main'],
    outputs: ['main', 'main', 'main', 'main', 'main', 'main'],
    properties: [
      {
        displayName: 'Branch Count',
        name: 'branchCount',
        type: 'options',
        options: [
          { name: '2', value: 2 },
          { name: '3', value: 3 },
          { name: '4', value: 4 },
          { name: '5', value: 5 },
          { name: '6', value: 6 },
        ],
        default: 2,
        description: 'How many parallel branches to create',
      },
      {
        displayName: 'Execution ID Prefix',
        name: 'executionIdPrefix',
        type: 'string',
        default: 'dag',
        description: 'Optional prefix for the execution context ID',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const branchCount = this.getNodeParameter('branchCount', 0) as number;
    const executionIdPrefix = this.getNodeParameter('executionIdPrefix', 0) as string;
    const itemsIn = this.getInputData();
    const executionId = `${executionIdPrefix}_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;

    const outputItems: INodeExecutionData[][] = [];

    for (let branchIndex = 0; branchIndex < branchCount; branchIndex++) {
      const branchLabel = `Branch ${branchIndex + 1}`;
      const itemsWithContext = itemsIn.map((item) => {
        return {
          json: {
            ...item.json,
            _dagExecutionId: executionId,
            _dagTotalBranches: branchCount,
            _dagBranchIndex: branchIndex,
            _dagBranchLabel: branchLabel,
            _dagStatus: 'running',
            _dagTimestamp: new Date().toISOString(),
          },
          binary: item.binary,
          pairedItem: item.pairedItem,
        } as INodeExecutionData;
      });

      outputItems.push(itemsWithContext);
    }

    while (outputItems.length < 6) {
      outputItems.push([]);
    }

    return outputItems;
  }
}
