import { describe, expect, it } from 'vitest';
import {
	imdbLookupValues,
	isStremioAddonPath,
	normalizeImdbId,
	parseAddonResource,
	parseCatalogExtra,
	parseStremioApiKeyFromPath,
	parseStremioId,
	sanitizeLikeQuery,
	toStremioEpisodeId,
	toStremioMovieId
} from './ids.js';

describe('normalizeImdbId', () => {
	it('adds a tt prefix when missing', () => {
		expect(normalizeImdbId('0111161')).toBe('tt0111161');
	});

	it('keeps an existing tt prefix', () => {
		expect(normalizeImdbId('tt0111161')).toBe('tt0111161');
	});

	it('rejects non-imdb values', () => {
		expect(normalizeImdbId('tmdb:603')).toBeNull();
		expect(normalizeImdbId('')).toBeNull();
	});
});

describe('imdbLookupValues', () => {
	it('includes prefixed and bare forms', () => {
		expect(imdbLookupValues('tt0111161')).toEqual(['tt0111161', '0111161']);
	});
});

describe('toStremioMovieId', () => {
	it('prefers imdb over tmdb', () => {
		expect(toStremioMovieId('tt0111161', 278)).toBe('tt0111161');
		expect(toStremioMovieId(null, 278)).toBe('tmdb:278');
	});
});

describe('parseStremioId', () => {
	it('parses movie imdb ids', () => {
		expect(parseStremioId('movie', 'tt0111161')).toEqual({
			type: 'movie',
			imdbId: 'tt0111161',
			tmdbId: null,
			season: undefined,
			episode: undefined
		});
	});

	it('parses series episode ids', () => {
		expect(parseStremioId('series', 'tt0944947:1:5')).toEqual({
			type: 'series',
			imdbId: 'tt0944947',
			tmdbId: null,
			season: 1,
			episode: 5
		});
	});

	it('parses tmdb episode ids', () => {
		expect(parseStremioId('series', 'tmdb:1399:2:3')).toEqual({
			type: 'series',
			imdbId: null,
			tmdbId: 1399,
			season: 2,
			episode: 3
		});
	});

	it('ignores episode suffixes on movies', () => {
		expect(parseStremioId('movie', 'tt0111161:1:1')).toEqual({
			type: 'movie',
			imdbId: 'tt0111161',
			tmdbId: null,
			season: undefined,
			episode: undefined
		});
	});
});

describe('parseAddonResource', () => {
	it('parses manifest', () => {
		expect(parseAddonResource('manifest.json')).toEqual({ kind: 'manifest' });
		expect(parseAddonResource('manifest.json/')).toEqual({ kind: 'manifest' });
	});

	it('parses catalogs with extras', () => {
		expect(parseAddonResource('catalog/movie/cinephage-movies/search=Matrix&skip=100.json')).toEqual(
			{
				kind: 'catalog',
				type: 'movie',
				catalogId: 'cinephage-movies',
				extra: { search: 'Matrix', skip: 100 }
			}
		);
	});

	it('parses episode stream ids that contain colons', () => {
		expect(parseAddonResource('stream/series/tt0944947:1:1.json')).toEqual({
			kind: 'stream',
			type: 'series',
			id: 'tt0944947:1:1'
		});
	});
});

describe('parseCatalogExtra', () => {
	it('defaults skip to 0', () => {
		expect(parseCatalogExtra(undefined)).toEqual({ skip: 0 });
	});
});

describe('stremio path helpers', () => {
	it('extracts the api key from the addon path', () => {
		expect(parseStremioApiKeyFromPath('/stremio/cinephage_abc/manifest.json')).toBe(
			'cinephage_abc'
		);
		expect(isStremioAddonPath('/stremio/cinephage_abc/catalog/movie/cinephage-movies.json')).toBe(
			true
		);
		expect(isStremioAddonPath('/api/streaming/session/movie/1')).toBe(false);
	});

	it('strips like wildcards from search', () => {
		expect(sanitizeLikeQuery('%foo_bar%')).toBe('foo bar');
	});

	it('builds episode ids', () => {
		expect(toStremioEpisodeId('tt0944947', 1, 2)).toBe('tt0944947:1:2');
	});
});
