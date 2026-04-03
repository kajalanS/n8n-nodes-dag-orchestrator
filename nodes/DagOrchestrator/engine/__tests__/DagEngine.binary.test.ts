import { DagEngine } from '../DagEngine';
import { IDagConfig } from '../../types/Dag.types';
import { INodeExecutionData } from 'n8n-workflow';

describe('DagEngine Binary Buffers', () => {
  test('should store binary in branch1 and read it in branch2', async () => {
    const input: INodeExecutionData[] = [{ json: { root: true } }];

    // base64 for 'hello' is aGVsbG8=
    const base64Hello = 'aGVsbG8=';

    const config: IDagConfig = {
      executionMode: 'parallel',
      joinMode: 'waitForAll',
      outputFormat: 'merged',
      errorStrategy: 'stopOnFirst',
      branches: [
        {
          id: 'b1',
          name: 'Store',
          dependencies: [],
          dataType: 'binary',
          try: { operation: 'store', binaryWrite: { id: 'img1', data: base64Hello } }
        },
        {
          id: 'b2',
          name: 'Read',
          dependencies: ['b1'],
          dataType: 'binary',
          try: { operation: 'read', binaryRead: 'img1' }
        }
      ]
    };

    const engine = new DagEngine(config);
    const results = await engine.execute(input);

    expect(results.length).toBe(1);
    const merged = results[0].json as any;
    expect((merged['b1'] as any)[0].binaryStored).toBe('img1');
    expect((merged['b2'] as any)[0].binary).toBe(base64Hello);
  });
});
