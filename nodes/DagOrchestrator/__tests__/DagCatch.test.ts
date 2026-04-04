import { DagCatch } from '../DagCatch.node';
import { IExecuteFunctions } from 'n8n-workflow';

describe('DagCatch', () => {
    let mockExecuteFunctions: jest.Mocked<IExecuteFunctions>;

    beforeEach(() => {
        mockExecuteFunctions = {
            getNodeParameter: jest.fn(),
            getInputData: jest.fn(),
        } as any;
    });

    test('rethrow mode preserves original error message', async () => {
        mockExecuteFunctions.getNodeParameter
            .mockReturnValueOnce('rethrow') // recoveryMode
            .mockReturnValueOnce({}) // fallbackValue
            .mockReturnValueOnce(true); // logError

        mockExecuteFunctions.getInputData.mockReturnValue([
            {
                json: { _dagError: 'Original API failure: 500 Internal Server Error' },
                binary: {},
                pairedItem: undefined,
            },
        ]);

        const node = new DagCatch();
        node.description = node.description; // Ensure description is set

        // Expect the execute to throw with the original error
        await expect(node.execute.call(mockExecuteFunctions)).rejects.toThrow('Original API failure: 500 Internal Server Error');
    });

    test('fallback mode recovers with fallback data', async () => {
        const fallbackData = { recovered: true, message: 'Fallback used' };

        mockExecuteFunctions.getNodeParameter
            .mockReturnValueOnce('fallback') // recoveryMode
            .mockReturnValueOnce(fallbackData) // fallbackValue
            .mockReturnValueOnce(true); // logError

        mockExecuteFunctions.getInputData.mockReturnValue([
            {
                json: { _dagError: 'Some error', otherField: 'preserved' },
                binary: {},
                pairedItem: undefined,
            },
        ]);

        const node = new DagCatch();
        const result = await node.execute.call(mockExecuteFunctions);

        expect(result).toHaveLength(1);
        expect(result[0]).toHaveLength(1);
        expect(result[0][0].json._dagStatus).toBe('catch_recovered');
        expect(result[0][0].json._dagFallbackData).toEqual(fallbackData);
        expect(result[0][0].json._dagError).toBe('Some error'); // Preserved
        expect(result[0][0].json.otherField).toBe('preserved');
    });
});