import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import {
	createTestDb,
	destroyTestDb,
	clearTestDb,
	type TestDatabase
} from '../../../test/db-helper';
import { episodeFiles, episodes, movieFiles, movies, series } from '$lib/server/db/schema';
import { StremioAddonService } from './StremioAddonService.js';
import { DEFAULT_STREMIO_ADDON_SETTINGS } from '$lib/shared/stremio-format.js';

const testDb: TestDatabase = createTestDb();
const addon = new StremioAddonService(testDb.db);

beforeEach(() => {
	clearTestDb(testDb);
});

afterAll(() => {
	destroyTestDb(testDb);
});

describe('StremioAddonService', () => {
	it('advertises stream-only resources', () => {
		const manifest = addon.getManifest('Cinephage');
		expect(manifest.id).toBe('com.cinephage.library');
		expect(manifest.catalogs).toEqual([]);
		expect(manifest.resources).toEqual([
			{
				name: 'stream',
				types: ['movie', 'series'],
				idPrefixes: ['tt', 'tmdb:', 'imdb:']
			}
		]);
	});

	it('formats stream name and description with the AIOMedia template', async () => {
		await testDb.db.insert(movies).values({
			id: 'm-1',
			tmdbId: 603,
			imdbId: 'tt0133093',
			title: 'The Matrix',
			path: 'Matrix',
			hasFile: true
		});
		await testDb.db.insert(movieFiles).values([
			{
				id: 'f-strm',
				movieId: 'm-1',
				relativePath: 'The Matrix (1999).strm',
				sceneName: 'The.Matrix.1999.2160p.WEB',
				quality: { resolution: '2160p', codec: 'hevc', hdr: 'HDR10' },
				size: 64
			},
			{
				id: 'f-mkv',
				movieId: 'm-1',
				relativePath: 'The Matrix (1999).mkv',
				quality: { resolution: '1080p', codec: 'avc' },
				size: 20_000_000_000,
				mediaInfo: { videoCodec: 'H264', audioCodec: 'EAC3', audioChannels: 6 }
			}
		]);

		const { streams } = await addon.getStreams(
			'movie',
			'tt0133093',
			'https://media.example.com',
			'stream-key',
			DEFAULT_STREMIO_ADDON_SETTINGS
		);

		expect(streams[0].name).toBe('Cinephage 2160p | Cinephage');
		expect(streams[0].description).toContain('The.Matrix.1999.2160p.WEB');
		expect(streams[0].url).toBe(
			'https://media.example.com/api/streaming/stremio/movie/603?api_key=stream-key'
		);
		expect(streams[1].name).toBe('Cinephage 1080p | Cinephage');
		expect(streams[1].description).toContain('The Matrix (1999).mkv');
		expect(streams[1].description).toContain('H.264');
		expect(streams[1].description).toContain('DD+ 5.1');
		expect(streams[1].url).toBe(
			'https://media.example.com/api/streaming/library/movie/f-mkv/The%20Matrix%20(1999).mkv?api_key=stream-key'
		);
	});

	it('resolves episode streams from imdb season/episode ids', async () => {
		await testDb.db.insert(series).values({
			id: 's-1',
			tmdbId: 1399,
			imdbId: 'tt0944947',
			title: 'Game of Thrones',
			path: 'GoT',
			episodeFileCount: 1
		});
		await testDb.db.insert(episodes).values({
			id: 'e-1',
			seriesId: 's-1',
			seasonNumber: 1,
			episodeNumber: 1,
			title: 'Winter Is Coming',
			hasFile: true
		});
		await testDb.db.insert(episodeFiles).values({
			id: 'ef-1',
			seriesId: 's-1',
			seasonNumber: 1,
			episodeIds: ['e-1'],
			relativePath: 'Season 01/S01E01.strm',
			quality: { resolution: '1080p' }
		});

		const { streams } = await addon.getStreams(
			'series',
			'tt0944947:1:1',
			'https://media.example.com',
			'k'
		);
		expect(streams).toHaveLength(1);
		expect(streams[0].url).toBe(
			'https://media.example.com/api/streaming/stremio/tv/1399/1/1?api_key=k'
		);
	});

	it('returns no streams for titles that are not in the library', async () => {
		const { streams } = await addon.getStreams(
			'movie',
			'tt0000001',
			'https://media.example.com',
			'k'
		);
		expect(streams).toEqual([]);
	});
});
