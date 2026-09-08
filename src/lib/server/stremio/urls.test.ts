import { describe, expect, it } from 'vitest';
import {
	buildEpisodeLibraryFileUrl,
	buildEpisodeSessionUrl,
	buildMovieLibraryFileUrl,
	buildMovieSessionUrl,
	buildStremioDeepLink,
	buildStremioManifestUrl,
	isStrmPath,
	isWebReadyPath
} from './urls.js';

describe('stream url builders', () => {
	it('builds movie session URLs with master.m3u8 for Stremio/Nuvio', () => {
		expect(buildMovieSessionUrl('https://media.example.com', 603, 'key+1')).toBe(
			'https://media.example.com/api/streaming/session/movie/603/master.m3u8?api_key=key%2B1'
		);
	});

	it('builds tv session URLs with season, episode, and master.m3u8', () => {
		expect(buildEpisodeSessionUrl('https://media.example.com', 1399, 1, 2, 'k')).toBe(
			'https://media.example.com/api/streaming/session/tv/1399/1/2/master.m3u8?api_key=k'
		);
	});

	it('builds library file URLs with an optional filename hint fragment', () => {
		expect(buildMovieLibraryFileUrl('https://media.example.com', 'file-1', 'k')).toBe(
			'https://media.example.com/api/streaming/library/movie/file-1?api_key=k'
		);
		expect(
			buildMovieLibraryFileUrl('https://media.example.com', 'file-1', 'k', 'Movie.mkv')
		).toBe('https://media.example.com/api/streaming/library/movie/file-1?api_key=k#Movie.mkv');
		expect(buildEpisodeLibraryFileUrl('https://media.example.com', 'file-2', 'k')).toBe(
			'https://media.example.com/api/streaming/library/episode/file-2?api_key=k'
		);
	});

	it('builds a stremio install URL with an encoded key', () => {
		const manifest = buildStremioManifestUrl('https://media.example.com/', 'key/1');
		expect(manifest).toBe('https://media.example.com/stremio/key%2F1/manifest.json');
		expect(buildStremioDeepLink(manifest)).toBe(
			'stremio://media.example.com/stremio/key%2F1/manifest.json'
		);
	});
});

describe('path helpers', () => {
	it('detects strm placeholders vs playable files', () => {
		expect(isStrmPath('Movie.strm')).toBe(true);
		expect(isStrmPath('Movie.mkv')).toBe(false);
		expect(isWebReadyPath('Movie.strm')).toBe(true);
		expect(isWebReadyPath('Movie.mp4')).toBe(true);
		expect(isWebReadyPath('Movie.mkv')).toBe(false);
	});
});
