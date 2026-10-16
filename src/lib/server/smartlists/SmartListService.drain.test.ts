import { afterAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb, destroyTestDb, type TestDatabase } from '../../../test/db-helper.js';
import { rootFolders, smartListItems, smartLists } from '$lib/server/db/schema.js';

const testDb: TestDatabase = createTestDb();

vi.mock('$lib/server/db/index.js', () => ({
	get db() {
		return testDb.db;
	},
	get sqlite() {
		return testDb.sqlite;
	},
	initializeDatabase: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('$lib/server/tmdb.js', () => ({ tmdb: {} }));

const { SmartListService } = await import('./SmartListService.js');

type Internals = {
	autoAddItems: (list: { id: string }) => Promise<{ added: number }>;
	refreshingIds: Set<string>;
};

afterAll(() => {
	destroyTestDb(testDb);
});

describe('SmartListService.drainAutoAddBacklog', () => {
	it('auto-adds between refreshes for eligible lists only and updates list stats', async () => {
		const [folder] = await testDb.db
			.insert(rootFolders)
			.values({ name: 'Movies', path: `/media/${randomUUID()}`, mediaType: 'movie' })
			.returning();

		const makeList = async (
			name: string,
			values: Partial<typeof smartLists.$inferInsert> = {}
		): Promise<string> => {
			const [list] = await testDb.db
				.insert(smartLists)
				.values({
					name,
					mediaType: 'movie',
					filters: {},
					autoAddBehavior: 'add_only',
					rootFolderId: folder.id,
					itemsAutoAdded: 5,
					...values
				})
				.returning();
			return list.id;
		};

		const eligible = await makeList('eligible');
		const disabled = await makeList('auto-add off', { autoAddBehavior: 'disabled' });
		const noFolder = await makeList('no folder', { rootFolderId: null });
		const paused = await makeList('list disabled', { enabled: false });
		const justRefreshed = await makeList('just refreshed');
		const refreshing = await makeList('refreshing now');

		await testDb.db.insert(smartListItems).values([
			{
				smartListId: eligible,
				mediaType: 'movie',
				tmdbId: 1,
				title: 'A',
				position: 0,
				inLibrary: true
			},
			{
				smartListId: eligible,
				mediaType: 'movie',
				tmdbId: 2,
				title: 'B',
				position: 1,
				inLibrary: true
			},
			{ smartListId: eligible, mediaType: 'movie', tmdbId: 3, title: 'C', position: 2 }
		]);

		const service = SmartListService.getInstance();
		const internals = service as unknown as Internals;
		const autoAdd = vi.spyOn(internals, 'autoAddItems').mockResolvedValue({ added: 2 });
		internals.refreshingIds.add(refreshing);

		const added = await service.drainAutoAddBacklog(new Set([justRefreshed]));

		expect(added).toBe(2);
		expect(autoAdd.mock.calls.map(([list]) => list.id)).toEqual([eligible]);
		for (const skipped of [disabled, noFolder, paused]) {
			expect(autoAdd.mock.calls.some(([list]) => list.id === skipped)).toBe(false);
		}

		const [stats] = await testDb.db.select().from(smartLists).where(eq(smartLists.id, eligible));
		expect(stats.itemsAutoAdded).toBe(7);
		expect(stats.itemsInLibrary).toBe(2);
		// The lock is released afterwards; the in-flight refresh still holds its own
		expect(service.isRefreshing(eligible)).toBe(false);
		expect(service.isRefreshing(refreshing)).toBe(true);

		internals.refreshingIds.delete(refreshing);
		autoAdd.mockRestore();
	});
});
