import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	StremioCatalogProvider,
	getStremioAddonBaseUrl,
	parseStremioMeta,
	summarizeCatalog
} from './StremioCatalogProvider.js';

const BASE = 'https://aio.example.com/stremio/abc-123';

const manifest = {
	id: 'aiometadata',
	name: 'AIOMetadata',
	catalogs: [
		{ type: 'movie', id: 'mdblist.top', name: 'Top Movies', extra: [{ name: 'skip' }] },
		{ type: 'series', id: 'trakt.trending', name: 'Trending Shows', extra: [{ name: 'skip' }] },
		{
			type: 'movie',
			id: 'search',
			name: 'Search',
			extra: [{ name: 'search', isRequired: true }]
		},
		{ type: 'movie', id: 'static', name: 'No paging' }
	]
};

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function mockAddon(routes: Record<string, unknown>) {
	const fetchMock = vi.fn(async (input: string | URL | Request) => {
		const url = String(input);
		if (url in routes) return jsonResponse(routes[url]);
		return jsonResponse({ err: 'not found' }, 404);
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('getStremioAddonBaseUrl', () => {
	it('normalizes manifest, stremio:// and base URLs', () => {
		expect(getStremioAddonBaseUrl(`${BASE}/manifest.json`)).toBe(BASE);
		expect(getStremioAddonBaseUrl(`${BASE}/`)).toBe(BASE);
		expect(getStremioAddonBaseUrl('stremio://aio.example.com/stremio/abc-123/manifest.json')).toBe(
			BASE
		);
		expect(getStremioAddonBaseUrl('http://192.168.1.5:3232/manifest.json')).toBe(
			'http://192.168.1.5:3232'
		);
	});

	it('rejects non-http URLs and garbage', () => {
		expect(getStremioAddonBaseUrl('ftp://example.com/manifest.json')).toBeNull();
		expect(getStremioAddonBaseUrl('not a url')).toBeNull();
		expect(getStremioAddonBaseUrl('')).toBeNull();
	});
});

describe('parseStremioMeta', () => {
	it('reads IMDB, TMDB and TVDB style ids', () => {
		expect(parseStremioMeta({ id: 'tt0111161', type: 'movie', name: 'Shawshank' })).toMatchObject({
			imdbId: 'tt0111161',
			mediaType: 'movie'
		});
		expect(parseStremioMeta({ id: 'tmdb:1399', type: 'series', name: 'GoT' })).toMatchObject({
			tmdbId: 1399,
			mediaType: 'tv'
		});
		expect(parseStremioMeta({ id: 'tmdb:movie:603', name: 'The Matrix' })).toMatchObject({
			tmdbId: 603
		});
		expect(parseStremioMeta({ id: 'tvdb:81189', type: 'series', name: 'BB' })).toMatchObject({
			tvdbId: 81189
		});
		expect(
			parseStremioMeta({ id: 'tmdb:27205', imdb_id: 'tt1375666', name: 'Inception' })
		).toMatchObject({ tmdbId: 27205, imdbId: 'tt1375666' });
	});

	it('extracts the year and keeps only TMDB posters', () => {
		const item = parseStremioMeta({
			id: 'tt0903747',
			name: 'Breaking Bad',
			releaseInfo: '2008-2013',
			poster: 'https://image.tmdb.org/t/p/w500/ggFHVNu6YYI5L9pCfOacjizRGt.jpg'
		});
		expect(item?.year).toBe(2008);
		expect(item?.posterPath).toBe('/ggFHVNu6YYI5L9pCfOacjizRGt.jpg');

		expect(
			parseStremioMeta({ id: 'tt1', name: 'X', poster: 'https://images.metahub.space/p.jpg' })
				?.posterPath
		).toBeNull();
	});

	it('returns null when there is nothing to resolve', () => {
		expect(parseStremioMeta({ id: 'kitsu:1' } as never)).toBeNull();
	});
});

describe('summarizeCatalog', () => {
	it('flags catalogs that need extra input and paging support', () => {
		const [top, , search, staticCatalog] = manifest.catalogs.map(summarizeCatalog);
		expect(top).toMatchObject({
			key: 'movie/mdblist.top',
			mediaType: 'movie',
			requiresExtra: false,
			supportsPaging: true
		});
		expect(search.requiresExtra).toBe(true);
		expect(staticCatalog.supportsPaging).toBe(false);
	});
});

describe('StremioCatalogProvider', () => {
	const provider = new StremioCatalogProvider();

	it('validates the manifest URL', () => {
		expect(provider.validateConfig({ manifestUrl: `${BASE}/manifest.json` })).toBe(true);
		expect(provider.validateConfig({ manifestUrl: 'nope' })).toBe(false);
		expect(provider.validateConfig({})).toBe(false);
	});

	it('pages through selected catalogs until they run out', async () => {
		const page = (start: number, count: number) =>
			Array.from({ length: count }, (_, i) => ({
				id: `tt${start + i}`,
				type: 'movie',
				name: `Movie ${start + i}`
			}));
		const fetchMock = mockAddon({
			[`${BASE}/manifest.json`]: manifest,
			[`${BASE}/catalog/movie/mdblist.top.json`]: { metas: page(1, 100) },
			[`${BASE}/catalog/movie/mdblist.top/skip=100.json`]: { metas: page(101, 50) },
			[`${BASE}/catalog/movie/mdblist.top/skip=150.json`]: { metas: [] }
		});

		const result = await provider.fetchItems(
			{ manifestUrl: `${BASE}/manifest.json`, catalogs: 'movie/mdblist.top' },
			'movie'
		);

		expect(result.error).toBeUndefined();
		expect(result.items).toHaveLength(150);
		expect(result.items[149]).toMatchObject({ imdbId: 'tt150', mediaType: 'movie' });
		expect(fetchMock).toHaveBeenCalledTimes(4);
	});

	it('defaults to every plain catalog of the list media type', async () => {
		mockAddon({
			[`${BASE}/manifest.json`]: manifest,
			[`${BASE}/catalog/movie/mdblist.top.json`]: {
				metas: [{ id: 'tt1', type: 'movie', name: 'A' }]
			},
			[`${BASE}/catalog/movie/mdblist.top/skip=1.json`]: { metas: [] },
			[`${BASE}/catalog/movie/static.json`]: { metas: [{ id: 'tt2', name: 'B' }] }
		});

		const result = await provider.fetchItems({ manifestUrl: BASE }, 'movie');

		// Series catalog and the search catalog (required extra) are skipped
		expect(result.items.map((item) => item.imdbId)).toEqual(['tt1', 'tt2']);
		// Catalog type fills in a missing meta type
		expect(result.items[1].mediaType).toBe('movie');
	});

	it('respects maxItems and stops when an addon repeats a page', async () => {
		const repeated = {
			metas: [
				{ id: 'tt1', name: 'A' },
				{ id: 'tt2', name: 'B' }
			]
		};
		mockAddon({
			[`${BASE}/manifest.json`]: manifest,
			[`${BASE}/catalog/movie/mdblist.top.json`]: repeated,
			[`${BASE}/catalog/movie/mdblist.top/skip=2.json`]: repeated
		});

		const result = await provider.fetchItems(
			{ manifestUrl: BASE, catalogs: 'movie/mdblist.top', maxItems: 500 },
			'movie'
		);
		expect(result.items).toHaveLength(2);
	});

	it('returns an error when the URL is not a manifest', async () => {
		mockAddon({ [`${BASE}/manifest.json`]: [{ tmdb_id: 1 }] });

		const result = await provider.fetchItems({ manifestUrl: BASE }, 'movie');

		expect(result.items).toEqual([]);
		expect(result.error).toMatch(/manifest/i);
	});

	it('fails only when every selected catalog fails', async () => {
		mockAddon({
			[`${BASE}/manifest.json`]: manifest,
			[`${BASE}/catalog/movie/static.json`]: { metas: [{ id: 'tt9', name: 'Z' }] }
			// mdblist.top 404s
		});

		const result = await provider.fetchItems(
			{ manifestUrl: BASE, catalogs: 'movie/mdblist.top,movie/static' },
			'movie'
		);
		expect(result.error).toBeUndefined();
		expect(result.items.map((item) => item.imdbId)).toEqual(['tt9']);
	});
});
