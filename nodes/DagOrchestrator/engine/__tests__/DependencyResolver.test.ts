import { DependencyResolver } from '../DependencyResolver';
import { IBranch } from '../../types/Branch.types';

describe('DependencyResolver', () => {
    let resolver: DependencyResolver;

    beforeEach(() => {
        resolver = new DependencyResolver();
    });

    const createBranch = (id: string, deps: string[]): IBranch => ({
        id,
        name: `Branch ${id}`,
        dependencies: deps,
        dataType: 'json',
        try: { operation: 'test' },
    });

    test('should sort a simple linear chain', () => {
        const branches = [
            createBranch('C', ['B']),
            createBranch('A', []),
            createBranch('B', ['A']),
        ];

        const { orderedBranches } = resolver.resolveDependencies(branches);
        expect(orderedBranches.map(b => b.id)).toEqual(['A', 'B', 'C']);
    });

    test('should sort a diamond pattern correctly', () => {
        // A -> B -> D
        // A -> C -> D
        const branches = [
            createBranch('D', ['B', 'C']),
            createBranch('B', ['A']),
            createBranch('C', ['A']),
            createBranch('A', []),
        ];

        const { orderedBranches } = resolver.resolveDependencies(branches);
        const order = orderedBranches.map(b => b.id);

        expect(order[0]).toBe('A');
        expect(order.includes('B')).toBe(true);
        expect(order.includes('C')).toBe(true);
        expect(order[3]).toBe('D');
    });

    test('should preserve incoming edge counts for execution after sorting', () => {
        const branches = [
            createBranch('B', ['A']),
            createBranch('A', []),
        ];

        const { incomingEdgesCount } = resolver.resolveDependencies(branches);

        expect(incomingEdgesCount.get('A')).toBe(0);
        expect(incomingEdgesCount.get('B')).toBe(1);
    });

    test('should throw error on circular dependencies', () => {
        const branches = [
            createBranch('A', ['B']),
            createBranch('B', ['C']),
            createBranch('C', ['A']),
        ];

        expect(() => {
            resolver.resolveDependencies(branches);
        }).toThrow('Circular dependency detected');
    });

    test('should throw error on missing dependencies', () => {
        const branches = [
            createBranch('A', ['NON_EXISTENT']),
        ];

        expect(() => {
            resolver.resolveDependencies(branches);
        }).toThrow('depends on unknown branch');
    });
});
