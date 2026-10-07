/**
 * Stale / interrupted importing recovery.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb, destroyTestDb, clearTestDb } from '../../../../test/db-helper';
import { downloadClients, downloadQueue, movies } from '$lib/server/db/schema';

const testDb = createTestDb();

vi.mock('$lib/server/db', () => ({
	get db() {
		return testDb.db;
	},
	get sqlite() {
		return testDb.sqlite;
	},
	initializeDatabase: vi.fn().mockResolvedValue(undefined)
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

vi.mock('../monitoring/DownloadMonitorService', () => ({
	downloadMonitor: {
		markFailed: vi.fn(),
		markImporting: vi.fn().mockResolvedValue('success'),
		markImported: vi.fn()
	}
}));

const { ImportService, STALE_IMPORTING_MS } = await import('./ImportService.js');

const CLIENT_ID = randomUUID();

beforeAll(async () => {});

afterAll(() => {
	destroyTestDb(testDb);
});

beforeEach(async () => {
	clearTestDb(testDb);
	ImportService.resetInstance();
	await testDb.db.insert(downloadClients).values({
		id: CLIENT_ID,
		name: 'qbit',
		implementation: 'qbittorrent',
		enabled: true,
		host: 'localhost',
		port: 8080,
		useSsl: false,
		movieCategory: 'movies',
		tvCategory: 'tv'
	});
});

async function insertMovie(title: string, tmdbId: number): Promise<string> {
	const id = randomUUID();
	await testDb.db.insert(movies).values({
		id,
		tmdbId,
		title,
		path: `${title} (2026)`,
		monitored: true,
		hasFile: false
	});
	return id;
}

describe('ImportService interrupted importing recovery', () => {
	it('resets all importing rows on recoverInterruptedImports', async () => {
		const id = randomUUID();
		const movieId = await insertMovie('Stuck Import', 88001);
		await testDb.db.insert(downloadQueue).values({
			id,
			downloadClientId: CLIENT_ID,
			downloadId: `hash-${id}`,
			title: 'Stuck.Import.2026',
			protocol: 'torrent',
			status: 'importing',
			progress: '1',
			outputPath: '/downloads/Stuck.Import.2026',
			movieId,
			lastAttemptAt: new Date().toISOString(),
			addedAt: new Date().toISOString()
		});

		const service = ImportService.getInstance();
		// Avoid actually queuing a real import (no media/files in test DB)
		const requestImport = vi
			.spyOn(service, 'requestImport')
			.mockResolvedValue({ status: 'queued' });

		await service.recoverInterruptedImports();

		const [row] = await testDb.db.select().from(downloadQueue).where(eq(downloadQueue.id, id));
		expect(row?.status).toBe('completed');
		expect(row?.errorMessage).toMatch(/interrupted/i);
		expect(requestImport).toHaveBeenCalledWith(id);
	});

	it('only recovers live importing rows older than STALE_IMPORTING_MS', async () => {
		const freshId = randomUUID();
		const staleId = randomUUID();
		const now = Date.now();
		const freshMovieId = await insertMovie('Fresh Import', 88002);
		const staleMovieId = await insertMovie('Stale Import', 88003);

		await testDb.db.insert(downloadQueue).values([
			{
				id: freshId,
				downloadClientId: CLIENT_ID,
				downloadId: `hash-${freshId}`,
				title: 'Fresh.Import',
				protocol: 'torrent',
				status: 'importing',
				progress: '1',
				outputPath: '/downloads/Fresh',
				movieId: freshMovieId,
				lastAttemptAt: new Date(now - 5 * 60_000).toISOString(),
				addedAt: new Date().toISOString()
			},
			{
				id: staleId,
				downloadClientId: CLIENT_ID,
				downloadId: `hash-${staleId}`,
				title: 'Stale.Import',
				protocol: 'torrent',
				status: 'importing',
				progress: '1',
				outputPath: '/downloads/Stale',
				movieId: staleMovieId,
				lastAttemptAt: new Date(now - STALE_IMPORTING_MS - 60_000).toISOString(),
				addedAt: new Date().toISOString()
			}
		]);

		const service = ImportService.getInstance();
		vi.spyOn(service, 'requestImport').mockResolvedValue({ status: 'queued' });

		const recovered = await service.recoverStaleImportingItems(now);
		expect(recovered).toBe(1);

		const fresh = await testDb.db
			.select()
			.from(downloadQueue)
			.where(eq(downloadQueue.id, freshId))
			.then((r) => r[0]);
		const stale = await testDb.db
			.select()
			.from(downloadQueue)
			.where(eq(downloadQueue.id, staleId))
			.then((r) => r[0]);

		expect(fresh?.status).toBe('importing');
		expect(stale?.status).toBe('completed');
		expect(stale?.errorMessage).toMatch(/stuck/i);
	});
});
