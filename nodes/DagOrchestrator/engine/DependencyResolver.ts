import { IBranch } from '../types/Branch.types';

export class DependencyResolver {
	public resolveDependencies(branches: IBranch[]): {
		orderedBranches: IBranch[];
		adjacencyList: Map<string, string[]>;
		incomingEdgesCount: Map<string, number>;
	} {
		const adjacencyList = new Map<string, string[]>();
		const incomingEdgesCount = new Map<string, number>();
		const branchMap = new Map<string, IBranch>();

		// Initialize graph representations
		for (const branch of branches) {
			adjacencyList.set(branch.id, []);
			incomingEdgesCount.set(branch.id, 0);
			branchMap.set(branch.id, branch);
		}

		// Build graph
		for (const branch of branches) {
			for (const depId of processDependencies(branch.dependencies)) {
				if (!branchMap.has(depId)) {
					throw new Error(`Branch ${branch.id} depends on unknown branch ${depId}`);
				}
				
				// depId -> branch.id
				adjacencyList.get(depId)!.push(branch.id);
				incomingEdgesCount.set(branch.id, incomingEdgesCount.get(branch.id)! + 1);
			}
		}

		// Topological Sort (Kahn's Algorithm)
		const queue: string[] = [];
		for (const [branchId, count] of incomingEdgesCount.entries()) {
			if (count === 0) {
				queue.push(branchId);
			}
		}

		const orderedBranches: IBranch[] = [];
		let visitedCount = 0;

		while (queue.length > 0) {
			const currentId = queue.shift()!;
			orderedBranches.push(branchMap.get(currentId)!);
			visitedCount++;

			for (const dependentId of adjacencyList.get(currentId)!) {
				incomingEdgesCount.set(dependentId, incomingEdgesCount.get(dependentId)! - 1);
				if (incomingEdgesCount.get(dependentId) === 0) {
					queue.push(dependentId);
				}
			}
		}

		if (visitedCount !== branches.length) {
			throw new Error('Circular dependency detected in graph.');
		}

		// Return both the ordered list and dependency structures for dynamic execution
		return { orderedBranches, adjacencyList, incomingEdgesCount };
	}
}

function processDependencies(deps: string[] | undefined): string[] {
	if (!deps) return [];
	if (!Array.isArray(deps)) return [];
	return deps;
}
