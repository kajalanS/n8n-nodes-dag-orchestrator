import { DagEngine } from '../DagEngine';
import { IDagConfig } from '../../types/Dag.types';
import { INodeExecutionData } from 'n8n-workflow';

describe('DagEngine Retry Policies', () => {
  test('should not retry on 4xx when retryOn4xx is false', async () => {
    const input: INodeExecutionData[] = [{ json: {} }];

    const config: IDagConfig = {
      executionMode: 'parallel',
      joinMode: 'waitForAll',
      outputFormat: 'merged',
      errorStrategy: 'collectErrors',
      globalTimeout: 0,
      branches: [
        {
          id: 'b4xx',
          name: 'BadRequest',
          dependencies: [],
          dataType: 'json',
          try: { operation: 'throw:400' },
          retry: { maxAttempts: 3, delayMs: 1, backoff: 'none', retryOn4xx: false }
        }
      ]
    };

    const engine = new DagEngine(config);
    const results = await engine.execute(input);

    const merged = results[0].json as any;
    // errors should include one entry for the failed branch
    expect(Array.isArray(merged.errors)).toBe(true);
    expect(merged.errors.find((e: any) => e.branchId === 'b4xx')).toBeTruthy();
    // execution log should show only one try_failed_attempt
    const tryFails = merged.executionLog.filter((l: any) => l.event && l.event.startsWith('try_failed_attempt'));
    expect(tryFails.length).toBe(1);
  });

  test('should retry on 5xx when retryOn5xx is true', async () => {
    const input: INodeExecutionData[] = [{ json: {} }];

    const config: IDagConfig = {
      executionMode: 'parallel',
      joinMode: 'waitForAll',
      outputFormat: 'merged',
      errorStrategy: 'collectErrors',
      branches: [
        {
          id: 'b5xx',
          name: 'ServerError',
          dependencies: [],
          dataType: 'json',
          try: { operation: 'throw:500' },
          retry: { maxAttempts: 3, delayMs: 1, backoff: 'none', retryOn5xx: true }
        }
      ]
    };

    const engine = new DagEngine(config);
    const results = await engine.execute(input);

    const merged = results[0].json as any;
    expect(Array.isArray(merged.errors)).toBe(true);
    expect(merged.errors.find((e: any) => e.branchId === 'b5xx')).toBeTruthy();
    const tryFails = merged.executionLog.filter((l: any) => l.event && l.event.startsWith('try_failed_attempt'));
    // should have been attempted maxAttempts times
    expect(tryFails.length).toBe(3);
  });
});
