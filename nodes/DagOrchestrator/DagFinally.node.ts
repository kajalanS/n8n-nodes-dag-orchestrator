import {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';

const finalStatusFromContext = (status: string | undefined, forcedStatus: string): 'completed' | 'failed' => {
  if (forcedStatus === 'success') return 'completed';
  if (forcedStatus === 'failed') return 'failed';
  if (!status) return 'completed';

  const failedStates = ['try_failed', 'catch_failed', 'failed', 'timeout', 'skipped'];
  return failedStates.includes(status) ? 'failed' : 'completed';
};

export class DagFinally implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'DAG Finally',
    name: 'dagFinally',
    icon: 'file:icon.svg',
    group: ['transform'],
    version: 1,
    description: 'Always run at the end of a branch and mark final status.',
    defaults: {
      name: 'DAG Finally',
    },
    inputs: ['main'],
    outputs: ['main'],
    properties: [
      {
        displayName: 'Branch Label',
        name: 'branchLabel',
        type: 'string',
        default: 'branch_1',
        description: 'Must match the Branch Label set in the corresponding DagTry node.',
      },
      {
        displayName: 'Mark Status',
        name: 'markStatus',
        type: 'options',
        options: [
          { name: 'auto', value: 'auto' },
          { name: 'success', value: 'success' },
          { name: 'failed', value: 'failed' },
        ],
        default: 'auto',
        description: 'Detect success/failure automatically or force a status.',
      },
      {
        displayName: 'Cleanup Note',
        name: 'cleanupNote',
        type: 'string',
        default: '',
        description: 'Optional human-readable note added to execution log.',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const branchLabel = this.getNodeParameter('branchLabel', 0) as string;
    const markStatus = this.getNodeParameter('markStatus', 0) as string;
    const cleanupNote = this.getNodeParameter('cleanupNote', 0) as string;
    const items = this.getInputData();

    const outputItems = items.map((item) => {
      const previousStatus = item.json._dagStatus as string | undefined;
      const finalStatus = finalStatusFromContext(previousStatus, markStatus);

      return {
        json: {
          ...item.json,
          _dagBranchLabel: branchLabel,
          _dagStatus: finalStatus,
          _dagFinallyRan: true,
          _dagCleanupNote: cleanupNote,
          _dagTimestamp: new Date().toISOString(),
        },
        binary: item.binary,
        pairedItem: item.pairedItem,
      } as INodeExecutionData;
    });

    return [outputItems];
  }
}
