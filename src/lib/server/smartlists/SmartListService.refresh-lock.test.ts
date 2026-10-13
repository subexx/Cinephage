import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/db/index.js', () => ({
	db: {},
	sqlite: {},
	initializeDatabase: vi.fn()
}));
vi.mock('$lib/server/tmdb.js', () => ({ tmdb: {} }));

const { SmartListService, RefreshInProgressError } = await import('./SmartListService.js');

type Internals = {
	runRefresh: (id: string, type: 'automatic' | 'manual') => Promise<unknown>;
};

describe('SmartListService refresh lock', () => {
	it('runs one refresh per list at a time and releases the lock afterwards', async () => {
		const service = SmartListService.getInstance();
		let finish!: () => void;
		const run = vi
			.spyOn(service as unknown as Internals, 'runRefresh')
			.mockImplementation(
				() => new Promise((resolve) => (finish = () => resolve({ status: 'success' })))
			);

		expect(service.startRefreshInBackground('list-a', 'manual')).toBe(true);
		expect(service.isRefreshing('list-a')).toBe(true);

		// Second click and the scheduler are both turned away while it runs
		expect(service.startRefreshInBackground('list-a', 'manual')).toBe(false);
		await expect(service.refreshSmartList('list-a', 'automatic')).rejects.toBeInstanceOf(
			RefreshInProgressError
		);
		// Other lists are unaffected
		expect(service.isRefreshing('list-b')).toBe(false);

		finish();
		await vi.waitFor(() => expect(service.isRefreshing('list-a')).toBe(false));
		expect(run).toHaveBeenCalledTimes(1);
		run.mockRestore();
	});

	it('releases the lock when a refresh throws', async () => {
		const service = SmartListService.getInstance();
		const run = vi
			.spyOn(service as unknown as Internals, 'runRefresh')
			.mockRejectedValue(new Error('boom'));

		await expect(service.refreshSmartList('list-c', 'manual')).rejects.toThrow('boom');
		expect(service.isRefreshing('list-c')).toBe(false);
		run.mockRestore();
	});
});
