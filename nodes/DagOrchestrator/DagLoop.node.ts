import {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  IDataObject,
} from 'n8n-workflow';

const parseCondition = (condition: string): boolean => {
  if (!condition || condition.trim() === '') {
    return true;
  }

  const normalized = condition.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  try {
    return Boolean(JSON.parse(normalized));
  } catch {
    return false;
  }
};

export class DagLoop implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'DAG Loop',
    name: 'dagLoop',
    icon: 'file:icon.svg',
    group: ['transform'],
    version: 1,
    description: 'Loop over an array of items with isolated loop state.',
    defaults: {
      name: 'DAG Loop',
    },
    inputs: ['main'],
    outputs: ['main', 'main'],
    properties: [
      {
        displayName: 'Source Field',
        name: 'sourceField',
        type: 'string',
        default: 'items',
        description: 'The field in the input JSON that contains the array to loop over.',
      },
      {
        displayName: 'Batch Size',
        name: 'batchSize',
        type: 'number',
        default: 1,
        description: 'How many items to process per iteration. 1 = one at a time.',
      },
      {
        displayName: 'Max Iterations',
        name: 'maxIterations',
        type: 'number',
        default: 1000,
        description: 'Hard limit to prevent infinite loops.',
      },
      {
        displayName: 'Index Variable Name',
        name: 'indexVariableName',
        type: 'string',
        default: 'currentIndex',
        description: 'Name of the index field added to each output item.',
      },
      {
        displayName: 'Total Variable Name',
        name: 'totalVariableName',
        type: 'string',
        default: 'totalItems',
        description: 'Name of the total count field added to each output item.',
      },
      {
        displayName: 'Break Condition',
        name: 'breakCondition',
        type: 'string',
        default: '',
        description: 'n8n expression evaluated after each iteration. Loop stops if true.',
      },
      {
        displayName: 'Continue Condition',
        name: 'continueCondition',
        type: 'string',
        default: '',
        description: 'n8n expression evaluated before each iteration. Skips iteration if false.',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const sourceField = this.getNodeParameter('sourceField', 0) as string;
    const batchSize = this.getNodeParameter('batchSize', 0) as number;
    const maxIterations = this.getNodeParameter('maxIterations', 0) as number;
    const indexVariableName = this.getNodeParameter('indexVariableName', 0) as string;
    const totalVariableName = this.getNodeParameter('totalVariableName', 0) as string;
    const breakCondition = this.getNodeParameter('breakCondition', 0) as string;
    const continueCondition = this.getNodeParameter('continueCondition', 0) as string;

    const staticData = this.getWorkflowStaticData('node') as IDataObject;
    if (!staticData.dagLoopState) {
      staticData.dagLoopState = {} as IDataObject;
    }

    const items = this.getInputData();
    let state = staticData.dagLoopState as {
      items: INodeExecutionData[];
      currentIndex: number;
      totalItems: number;
      itemsProcessed: number;
      brokeEarly: boolean;
      sourceField: string;
    };

    if (!state.items || state.sourceField !== sourceField) {
      const inputItem = items[0];
      const sourceValue = inputItem?.json?.[sourceField];

      if (!Array.isArray(sourceValue)) {
        throw new Error(`Source field '${sourceField}' must contain an array.`);
      }

      state = {
        items: sourceValue.map((entry: any) => {
          return {
            json: typeof entry === 'object' && entry !== null ? { ...entry } : { value: entry },
          } as INodeExecutionData;
        }),
        currentIndex: 0,
        totalItems: sourceValue.length,
        itemsProcessed: 0,
        brokeEarly: false,
        sourceField,
      };
      staticData.dagLoopState = state;
    }

    const bodyItems: INodeExecutionData[] = [];
    const remaining = state.totalItems - state.currentIndex;
    const batchCount = Math.min(batchSize, remaining);

    for (let offset = 0; offset < batchCount; offset += 1) {
      if (state.itemsProcessed >= maxIterations) {
        state.brokeEarly = true;
        break;
      }

      const itemIndex = state.currentIndex;
      const inputItem = state.items[itemIndex];
      const shouldContinue = continueCondition ? parseCondition(continueCondition) : true;

      if (shouldContinue) {
        bodyItems.push({
          json: {
            ...inputItem.json,
            [indexVariableName]: itemIndex,
            [totalVariableName]: state.totalItems,
            isFirstItem: itemIndex === 0,
            isLastItem: itemIndex === state.totalItems - 1,
          },
          binary: inputItem.binary,
          pairedItem: inputItem.pairedItem,
        } as INodeExecutionData);
      }

      state.currentIndex += 1;
      state.itemsProcessed += 1;

      const shouldBreak = breakCondition ? parseCondition(breakCondition) : false;
      if (shouldBreak) {
        state.brokeEarly = true;
        break;
      }
    }

    const done = state.currentIndex >= state.totalItems || state.itemsProcessed >= maxIterations || state.brokeEarly;

    if (done) {
      const summary: INodeExecutionData = {
        json: {
          _dagLoopComplete: true,
          totalIterations: state.itemsProcessed,
          itemsProcessed: state.currentIndex,
          brokeEarly: state.brokeEarly,
          source: sourceField,
        },
      };
      delete staticData.dagLoopState;
      return [bodyItems, [summary]];
    }

    return [bodyItems, []];
  }
}
