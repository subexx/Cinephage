import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, destroyTestDb, type TestDatabase } from '../../../test/db-helper.js';
import { smartLists, smartListItems, type SmartListRecord } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';

const testDb: TestDatabase = createTestDb();

const mocks = vi.hoisted(() => ({
	getBlockedTmdbIdSet: vi.fn()
}));

vi.mock('$lib/server/db/index.js', () => ({
	get db() {
		return testDb.db;
	},
	get sqlite() {
		return testDb.sqlite;
	},
	initializeDatabase: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('$lib/server/library/status.js', () => ({
	getBlockedTmdbIdSet: mocks.getBlockedTmdbIdSet
}));
vi.mock('$lib/server/tmdb.js', () => ({ tmdb: {} }));

const { SmartListService } = await import('./SmartListService.js');

type Selector = {
	selectAutoAddCandidates(
		list: SmartListRecord,
		mediaType: 'movie' | 'tv'
	): Promise<{ tmdbId: number }[]>;
	recordAutoAddFailure(item: { id: string }, error: unknown): Promise<void>;
};
const service = SmartListService.getInstance() as unknown as Selector;

afterAll(() => {
	destroyTestDb(testDb);
});

async function createList(excludedTmdbIds: number[] = []): Promise<SmartListRecord> {
	const [list] = await testDb.db
		.insert(smartLists)
		.values({
			id: randomUUID(),
			name: `List ${randomUUID()}`,
			mediaType: 'movie',
			filters: {},
			excludedTmdbIds
		})
		.returning();
	return list;
}

async function addItems(
	listId: string,
	count: number,
	overrides: (index: number) => Partial<typeof smartListItems.$inferInsert> = () => ({})
): Promise<void> {
	const rows = Array.from({ length: count }, (_, i) => ({
		smartListId: listId,
		mediaType: 'movie' as const,
		tmdbId: 1000 + i,
		title: `Movie ${i}`,
		position: i,
		...overrides(i)
	}));
	for (let i = 0; i < rows.length; i += 100) {
		await testDb.db.insert(smartListItems).values(rows.slice(i, i + 100));
	}
}

describe('SmartListService auto-add candidate selection', () => {
	beforeEach(() => {
		mocks.getBlockedTmdbIdSet.mockResolvedValue(new Set<number>());
	});

	it('takes the highest ranked items, capped at the batch size', async () => {
		const list = await createList();
		await addItems(list.id, 40);

		const selected = await service.selectAutoAddCandidates(list, 'movie');

		expect(selected.map((item) => item.tmdbId)).toEqual(
			Array.from({ length: 25 }, (_, i) => 1000 + i)
		);
	});

	it('skips excluded and blocked items instead of letting them fill the batch', async () => {
		// First 30 ranked items are all excluded or blocked
		const list = await createList([1000, 1001]);
		await addItems(list.id, 60, (i) => ({ isExcluded: i >= 2 && i < 15 }));
		mocks.getBlockedTmdbIdSet.mockResolvedValue(
			new Set(Array.from({ length: 15 }, (_, i) => 1015 + i))
		);

		const selected = await service.selectAutoAddCandidates(list, 'movie');

		expect(selected).toHaveLength(25);
		expect(selected[0].tmdbId).toBe(1030);
	});

	it('looks past a full scan page of ineligible items', async () => {
		const list = await createList();
		await addItems(list.id, 260, (i) => ({ isExcluded: i < 250 }));

		const selected = await service.selectAutoAddCandidates(list, 'movie');

		expect(selected.map((item) => item.tmdbId)).toEqual(
			Array.from({ length: 10 }, (_, i) => 1250 + i)
		);
	});

	it('backs off items that keep failing, and retries them after the retry window', async () => {
		const list = await createList();
		const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
		await addItems(list.id, 3, (i) => ({
			autoAddAttempts: 3,
			lastAutoAddAttemptAt: i === 2 ? eightDaysAgo : new Date().toISOString()
		}));
		await addItems(list.id, 1, () => ({ tmdbId: 2000, position: 10 }));

		const selected = await service.selectAutoAddCandidates(list, 'movie');

		expect(selected.map((item) => item.tmdbId)).toEqual([1002, 2000]);
	});

	it('records failures with an incrementing attempt count', async () => {
		const list = await createList();
		await addItems(list.id, 1);
		const [item] = await testDb.db
			.select()
			.from(smartListItems)
			.where(eq(smartListItems.smartListId, list.id));

		await service.recordAutoAddFailure(item, new Error('TMDB timeout'));
		await service.recordAutoAddFailure(item, new Error('TMDB timeout again'));

		const [updated] = await testDb.db
			.select()
			.from(smartListItems)
			.where(eq(smartListItems.id, item.id));
		expect(updated.autoAddAttempts).toBe(2);
		expect(updated.lastAutoAddError).toBe('TMDB timeout again');
		expect(updated.lastAutoAddAttemptAt).toBeTruthy();
	});

	it('ignores items already in the library or removed from the list', async () => {
		const list = await createList();
		await addItems(list.id, 4, (i) => ({
			inLibrary: i === 0,
			position: i === 1 ? 9999 : i
		}));

		const selected = await service.selectAutoAddCandidates(list, 'movie');

		expect(selected.map((item) => item.tmdbId)).toEqual([1002, 1003]);
	});
});
