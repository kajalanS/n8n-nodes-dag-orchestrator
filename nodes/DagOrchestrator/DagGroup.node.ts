import {
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
} from 'n8n-workflow';

export class DagGroup implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'DAG Group',
        name: 'dagGroup',
        icon: 'file:icon.svg',
        group: ['transform'],
        version: 1,
        description: 'Group branches into a named subgraph. Place a DAG Split after this node to start the inner DAG.',
        defaults: {
            name: 'DAG Group',
        },
        inputs: ['main'],
        outputs: ['main'],
        outputNames: ['Group Output'],
        properties: [
            {
                displayName: 'Group Label',
                name: 'groupLabel',
                type: 'string',
                default: 'group_1',
                description: 'Unique name for this group. Used in output data and logs.',
            },
            {
                displayName: 'Group Timeout (ms)',
                name: 'groupTimeout',
                type: 'number',
                default: 0,
                description: 'If > 0, total time allowed for the entire group. 0 means no timeout.',
            },
            {
                displayName: 'Group Error Strategy',
                name: 'errorStrategy',
                type: 'options',
                options: [
                    { name: 'stopOnFirst', value: 'stopOnFirst' },
                    { name: 'continueOnError', value: 'continueOnError' },
                    { name: 'collectErrors', value: 'collectErrors' },
                ],
                default: 'continueOnError',
                description: 'How to handle errors: stopOnFirst / continueOnError / collectErrors',
            },
            {
                displayName: 'Group Description',
                name: 'description',
                type: 'string',
                default: '',
                description: 'Human-readable note about what this group does.',
            },
        ],
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const groupLabel = this.getNodeParameter('groupLabel', 0) as string;
        const groupTimeout = this.getNodeParameter('groupTimeout', 0) as number;
        const errorStrategy = this.getNodeParameter('errorStrategy', 0) as string;
        const description = this.getNodeParameter('description', 0) as string;

        const inputItems = this.getInputData();

        const outputItems = inputItems.map((item) => {
            return {
                json: {
                    ...item.json,
                    _dagGroupLabel: groupLabel,
                    _dagGroupTimeout: groupTimeout,
                    _dagGroupErrorStrategy: errorStrategy,
                    _dagGroupDescription: description,
                    _dagGroupEnteredAt: new Date().toISOString(),
                },
                binary: item.binary || {},
                pairedItem: item.pairedItem,
            } as INodeExecutionData;
        });

        return [outputItems];
    }
}
