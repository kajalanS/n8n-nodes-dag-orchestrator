import {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  IDataObject,
} from 'n8n-workflow';

interface JoinBranchSummary {
  status: string;
  data: INodeExecutionData[];
  error?: string;
}

interface JoinAccumulator {
  startTime: number;
  branches: Record<string, JoinBranchSummary>;
}

const determineBranchStatus = (items: INodeExecutionData[]): 'completed' | 'failed' => {
  const failedStates = ['try_failed', 'catch_failed', 'failed', 'timeout'];
  return items.some((item) => failedStates.includes(item.json._dagStatus as string)) ? 'failed' : 'completed';
};

const extractBranchError = (items: INodeExecutionData[]): string | undefined => {
  return items.find((item) => item.json._dagError)?.json._dagError as string | undefined;
};

export class DagJoin implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'DAG Join',
    name: 'dagJoin',
    icon: 'file:icon.svg',
    group: ['transform'],
    version: 1,
    description: 'Collect and merge results from all branches into one output.',
    defaults: {
      name: 'DAG Join',
    },
    inputs: ['main'],
    outputs: ['main'],
    properties: [
      {
        displayName: 'Expected Branch Count',
        name: 'expectedBranchCount',
        type: 'number',
        default: 2,
        description: 'Must match the Branch Count set in DagSplit.',
      },
      {
        displayName: 'Join Mode',
        name: 'joinMode',
        type: 'options',
        options: [
          { name: 'waitForAll', value: 'waitForAll' },
          { name: 'waitForFirst', value: 'waitForFirst' },
          { name: 'waitForAny', value: 'waitForAny' },
        ],
        default: 'waitForAll',
      },
      {
        displayName: 'Output Format',
        name: 'outputFormat',
        type: 'options',
        options: [
          { name: 'merged', value: 'merged' },
          { name: 'array', value: 'array' },
          { name: 'passthrough', value: 'passthrough' },
        ],
        default: 'merged',
      },
      {
        displayName: 'Error Strategy',
        name: 'errorStrategy',
        type: 'options',
        options: [
          { name: 'continueOnError', value: 'continueOnError' },
          { name: 'stopOnFirst', value: 'stopOnFirst' },
          { name: 'collectErrors', value: 'collectErrors' },
        ],
        default: 'continueOnError',
      },
      {
        displayName: 'Global Timeout (ms)',
        name: 'globalTimeout',
        type: 'number',
        default: 60000,
        description: 'How long to wait for all branches before timing out.',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const expectedBranchCount = this.getNodeParameter('expectedBranchCount', 0) as number;
    const joinMode = this.getNodeParameter('joinMode', 0) as string;
    const outputFormat = this.getNodeParameter('outputFormat', 0) as string;
    const errorStrategy = this.getNodeParameter('errorStrategy', 0) as string;
    const globalTimeout = this.getNodeParameter('globalTimeout', 0) as number;

    const staticData = this.getWorkflowStaticData('node') as IDataObject;
    const joinStorage = staticData.dagJoinAccumulator as Record<string, JoinAccumulator> | undefined;
    if (!joinStorage) {
      staticData.dagJoinAccumulator = {} as Record<string, JoinAccumulator>;
    }
    const joinAccumulator = staticData.dagJoinAccumulator as Record<string, JoinAccumulator>;

    const results: INodeExecutionData[] = [];
    const items = this.getInputData();

    const execGroups: Record<string, INodeExecutionData[]> = {};
    for (const item of items) {
      const key = item.json._dagExecutionId as string || 'unknown';
      if (!execGroups[key]) execGroups[key] = [];
      execGroups[key].push(item);
    }

    for (const [executionId, groupItems] of Object.entries(execGroups)) {
      const existingAccumulator = joinAccumulator[executionId] as JoinAccumulator | undefined;
      const accumulator: JoinAccumulator = existingAccumulator || {
        startTime: Date.now(),
        branches: {},
      };

      for (const item of groupItems) {
        const branchLabel = (item.json._dagBranchLabel as string) || `branch_${Object.keys(accumulator.branches).length + 1}`;
        if (!accumulator.branches[branchLabel]) {
          accumulator.branches[branchLabel] = {
            status: 'completed',
            data: [],
          };
        }
        accumulator.branches[branchLabel].data.push(item);
        accumulator.branches[branchLabel].status = determineBranchStatus(accumulator.branches[branchLabel].data);
        const error = extractBranchError(accumulator.branches[branchLabel].data);
        if (error) accumulator.branches[branchLabel].error = error;
      }

      joinAccumulator[executionId] = accumulator;

      const branchCount = Object.keys(accumulator.branches).length;
      const now = Date.now();
      const timedOut = globalTimeout > 0 && now - accumulator.startTime >= globalTimeout;
      const emitBecauseAll = joinMode === 'waitForAll' && branchCount >= expectedBranchCount;
      const emitBecauseAny = joinMode !== 'waitForAll' && branchCount > 0;
      const emitBecauseTimeout = timedOut && branchCount > 0;
      const shouldEmit = emitBecauseAll || emitBecauseAny || emitBecauseTimeout;

      if (!shouldEmit) {
        continue;
      }

      const branches: Record<string, JoinBranchSummary> = {};
      const branchErrors: any[] = [];
      let hasFailed = false;
      let firstBranchItems: INodeExecutionData[] = [];

      for (const [label, summaryValue] of Object.entries(accumulator.branches)) {
        const summary = summaryValue as JoinBranchSummary;
        branches[label] = {
          status: summary.status,
          data: summary.data,
          error: summary.error,
        };
        if (summary.status === 'failed') {
          hasFailed = true;
          if (summary.error) branchErrors.push({ branch: label, error: summary.error });
        }
        if (!firstBranchItems.length) {
          firstBranchItems = summary.data;
        }
      }

      if (errorStrategy === 'stopOnFirst' && hasFailed) {
        delete joinAccumulator[executionId];
        throw new Error(`DAG Join stopped because branch failed in execution ${executionId}.`);
      }

      const outputPayload: IDataObject = {
        _dagExecutionId: executionId,
        _dagJoinMode: joinMode,
        _dagCompletedAt: new Date().toISOString(),
        branches,
      };

      if (errorStrategy === 'collectErrors' && branchErrors.length) {
        outputPayload.errors = branchErrors;
      }
      if (emitBecauseTimeout) {
        outputPayload.timedOut = true;
      }

      let outputItemsForExec: INodeExecutionData[] = [];
      if (outputFormat === 'merged') {
        outputItemsForExec = [{ json: outputPayload }];
      } else if (outputFormat === 'array') {
        outputItemsForExec = [
          {
            json: {
              ...outputPayload,
              branches: Object.entries(branches).map(([label, branch]) => ({ label, ...branch })),
            },
          },
        ];
      } else {
        outputItemsForExec = firstBranchItems;
      }

      results.push(...outputItemsForExec);
      delete joinAccumulator[executionId];
    }

    return [results];
  }
}
