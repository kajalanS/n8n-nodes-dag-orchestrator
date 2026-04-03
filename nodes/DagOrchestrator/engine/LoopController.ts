import { INodeExecutionData } from 'n8n-workflow';
import { ILoopState } from '../types/State.types';

export class LoopController {
  private loops: Record<string, ILoopState> = {};

  public initializeLoop(loopId: string, items: INodeExecutionData[]): void {
    this.loops[loopId] = {
      currentIndex: 0,
      totalItems: items.length,
      items,
      accumulatedResults: [],
    };
  }

  public getNextItem(loopId: string): INodeExecutionData | null {
    const loop = this.loops[loopId];
    if (!loop || loop.currentIndex >= loop.totalItems) {
      return null;
    }

    const item = loop.items[loop.currentIndex];
    loop.currentIndex++;
    return item;
  }

  public storeResult(loopId: string, result: INodeExecutionData[], index?: number): void {
    const loop = this.loops[loopId];
    if (loop) {
      const idx = typeof index === 'number' ? index : loop.accumulatedResults.length;
      loop.accumulatedResults.push({ index: idx, result });
    }
  }

  public getLoopState(loopId: string): ILoopState | undefined {
    return this.loops[loopId];
  }

  public breakLoop(loopId: string, breakIndex?: number): void {
    const loop = this.loops[loopId];
    if (loop) {
      loop.breakIndex = typeof breakIndex === 'number' ? breakIndex : loop.currentIndex - 1;
      loop.currentIndex = loop.totalItems;
    }
  }
}
