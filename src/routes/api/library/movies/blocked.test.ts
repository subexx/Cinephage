import { afterAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, destroyTestDb, type TestDatabase } from '../../../../test/db-helper';
import { api } from '../../../../test/api-helper';
import { blockedMedia, movies, rootFolders } from '$lib/server/db/schema.js';

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

const fetchMovieDetails = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/library/LibraryAddService.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/library/LibraryAddService.js')>();
	return { ...actual, fetchMovieDetails };
});

const { POST } = await import('./+server');

afterAll(() => {
	destroyTestDb(testDb);
});

// 2026-10-17: a blocked movie kept coming back through a request app (Radarr API)
describe('POST /api/library/movies blocked media', () => {
	it('refuses to add a blocked movie and never touches TMDB', async () => {
		const [folder] = await testDb.db
			.insert(rootFolders)
			.values({ name: 'Movies', path: `/media/${randomUUID()}`, mediaType: 'movie' })
			.returning();
		await testDb.db
			.insert(blockedMedia)
			.values({ tmdbId: 4242, mediaType: 'movie', title: 'Aasha' });

		const { status, data } = await api.post<{ success: boolean; error: string }>(POST, {
			tmdbId: 4242,
			rootFolderId: folder.id
		});

		expect(status).toBe(409);
		expect(data.error).toMatch(/blocked/i);
		expect(fetchMovieDetails).not.toHaveBeenCalled();
		expect(await testDb.db.select().from(movies)).toHaveLength(0);
	});
});
