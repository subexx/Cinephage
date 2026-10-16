import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, destroyTestDb, type TestDatabase } from '../../../../test/db-helper.js';
import { movies, rootFolders } from '$lib/server/db/schema.js';

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

const { monitoringSearchService } = await import('./MonitoringSearchService.js');

type SearchAndGrab = {
	searchAndGrabMovie: (movie: { id: string; title: string }) => Promise<unknown>;
};

afterAll(() => {
	destroyTestDb(testDb);
});

const HOUR = 60 * 60 * 1000;

async function seedMovies(): Promise<Map<string, string>> {
	await testDb.db.delete(movies);
	await testDb.db.delete(rootFolders);
	const [folder] = await testDb.db
		.insert(rootFolders)
		.values({ name: 'Movies', path: `/media/movies-${randomUUID()}`, mediaType: 'movie' })
		.returning();

	const now = Date.now();
	const rows = [
		{ title: 'Searched 3 days ago', lastSearchTime: new Date(now - 72 * HOUR).toISOString() },
		{ title: 'Never searched A', lastSearchTime: null },
		{ title: 'Searched 2 days ago', lastSearchTime: new Date(now - 48 * HOUR).toISOString() },
		{ title: 'Never searched B', lastSearchTime: null },
		{ title: 'Searched 1 hour ago', lastSearchTime: new Date(now - 1 * HOUR).toISOString() }
	];
	const ids = new Map<string, string>();
	for (const [index, row] of rows.entries()) {
		const [movie] = await testDb.db
			.insert(movies)
			.values({
				tmdbId: 5000 + index,
				title: row.title,
				path: `movie-${index}`,
				rootFolderId: folder.id,
				monitored: true,
				hasFile: false,
				minimumAvailability: 'announced',
				desiredQualities: null,
				lastSearchTime: row.lastSearchTime
			})
			.returning();
		ids.set(movie.id, row.title);
	}
	return ids;
}

describe('MonitoringSearchService missing movie budget', () => {
	let searched: string[];

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['setTimeout'] });
		searched = [];
		vi.spyOn(
			monitoringSearchService as unknown as SearchAndGrab,
			'searchAndGrabMovie'
		).mockImplementation(async (movie) => {
			searched.push(movie.title);
			return {
				itemId: movie.id,
				itemType: 'movie',
				title: movie.title,
				searched: true,
				releasesFound: 0,
				grabbed: false
			};
		});
	});

	async function run(options: { maxSearches?: number; cooldownHours?: number }) {
		const promise = monitoringSearchService.searchMissingMovies(undefined, options);
		await vi.runAllTimersAsync();
		const result = await promise;
		vi.useRealTimers();
		return result;
	}

	it('searches never-searched movies first, then the longest-waiting, up to the budget', async () => {
		await seedMovies();

		await run({ maxSearches: 3, cooldownHours: 6 });

		expect(searched).toEqual(['Never searched A', 'Never searched B', 'Searched 3 days ago']);
	});

	it('continues through the backlog on the next run instead of repeating', async () => {
		await seedMovies();

		await run({ maxSearches: 3, cooldownHours: 6 });
		vi.useFakeTimers({ toFake: ['setTimeout'] });
		searched = [];
		await run({ maxSearches: 3, cooldownHours: 6 });

		// The one searched an hour ago is still on cooldown
		expect(searched).toEqual(['Searched 2 days ago']);
	});

	it('is unlimited when no budget is set', async () => {
		await seedMovies();

		await run({ cooldownHours: 6 });

		expect(searched).toHaveLength(4);
	});
});
