import { DagEngine } from '../DagEngine';
import { IDagConfig } from '../../types/Dag.types';
import { INodeExecutionData } from 'n8n-workflow';

describe('DagEngine Looping', () => {
  test('should run branch for each loop item and accumulate results', async () => {
    const input: INodeExecutionData[] = [{ json: { root: true } }];

    const config: IDagConfig = {
      executionMode: 'parallel',
      joinMode: 'waitForAll',
      outputFormat: 'merged',
      errorStrategy: 'stopOnFirst',
      branches: [
        {
          id: 'loopBranch',
          name: 'Loop Branch',
          dependencies: [],
          dataType: 'json',
          loop: { source: [{ json: { item: 1 } }, { json: { item: 2 } }] },
          try: { operation: 'opLoop' }
        }
      ]
    };

    const engine = new DagEngine(config);
    const results = await engine.execute(input);

    expect(results.length).toBe(1);
    const merged = results[0].json as any;
    expect(Array.isArray(merged['loopBranch'])).toBe(true);
    expect(merged['loopBranch'].length).toBe(2);
    expect(merged['loopBranch'][0].operationExecuted).toBe('opLoop');
  });

  test('should run loop with batchSize and accumulate results', async () => {
    const input: INodeExecutionData[] = [{ json: { root: true } }];

    const config: IDagConfig = {
      executionMode: 'parallel',
      joinMode: 'waitForAll',
      outputFormat: 'merged',
      errorStrategy: 'stopOnFirst',
      branches: [
        {
          id: 'loopBatch',
          name: 'Loop Batch',
          dependencies: [],
          dataType: 'json',
          loop: { source: [{ json: { item: 1 } }, { json: { item: 2 } }, { json: { item: 3 } }], batchSize: 2 },
          try: { operation: 'opBatch' }
        }
      ]
    };

    const engine = new DagEngine(config);
    const results = await engine.execute(input);
    const merged = results[0].json as any;
    expect(Array.isArray(merged['loopBatch'])).toBe(true);
    expect(merged['loopBatch'].length).toBe(3);
  });

  test('continueCondition function should skip items', async () => {
    const input: INodeExecutionData[] = [{ json: {} }];

    const config: IDagConfig = {
      executionMode: 'parallel',
      joinMode: 'waitForAll',
      outputFormat: 'merged',
      errorStrategy: 'stopOnFirst',
      branches: [
        {
          id: 'loopCont',
          name: 'Loop Continue',
          dependencies: [],
          dataType: 'json',
          loop: { source: [{ json: { item: 1 } }, { json: { item: 2 } }, { json: { item: 3 } }], batchSize: 2, continueCondition: ({ item }: any) => item.json.item !== 2 },
          try: { operation: 'opCont' }
        }
      ]
    };

    const engine = new DagEngine(config);
    const results = await engine.execute(input);
    const merged = results[0].json as any;
    expect(Array.isArray(merged['loopCont'])).toBe(true);
    // item 2 should be skipped, so only 2 results
    expect(merged['loopCont'].length).toBe(2);
  });

  test('breakCondition function should stop loop early', async () => {
    const input: INodeExecutionData[] = [{ json: {} }];

    const config: IDagConfig = {
      executionMode: 'parallel',
      joinMode: 'waitForAll',
      outputFormat: 'merged',
      errorStrategy: 'stopOnFirst',
      branches: [
        {
          id: 'loopBreak',
          name: 'Loop Break',
          dependencies: [],
          dataType: 'json',
          loop: { source: [{ json: { item: 1 } }, { json: { item: 2 } }, { json: { item: 3 } }], batchSize: 2, breakCondition: ({ item }: any) => item.json.item === 2 },
          try: { operation: 'opBreak' }
        }
      ]
    };

    const engine = new DagEngine(config);
    const results = await engine.execute(input);
    const merged = results[0].json as any;
    expect(Array.isArray(merged['loopBreak'])).toBe(true);
    // should have run item 1 and 2 then stopped before 3
    expect(merged['loopBreak'].length).toBe(2);
  });
});
