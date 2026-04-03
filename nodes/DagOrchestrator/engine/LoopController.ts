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

	public storeResult(loopId: string, result: INodeExecutionData[]): void {
		const loop = this.loops[loopId];
		if (loop) {
			loop.accumulatedResults.push(result);
		}
	}

	public getLoopState(loopId: string): ILoopState | undefined {
		return this.loops[loopId];
	}
}
