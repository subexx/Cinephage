import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	MdblistProvider,
	fetchMdblistUserLists,
	parseMdblistItem,
	parseMdblistListRef
} from './MdblistProvider.js';

function jsonResponse(
	body: unknown,
	init: { status?: number; headers?: Record<string, string> } = {}
) {
	return new Response(JSON.stringify(body), {
		status: init.status ?? 200,
		headers: { 'content-type': 'application/json', ...(init.headers ?? {}) }
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('parseMdblistListRef', () => {
	it('accepts URLs, user/slug and numeric ids', () => {
		expect(parseMdblistListRef('https://mdblist.com/lists/garycrawfordgc/latest-tv-shows')).toEqual(
			{
				kind: 'slug',
				username: 'garycrawfordgc',
				slug: 'latest-tv-shows'
			}
		);
		expect(parseMdblistListRef('https://mdblist.com/lists/user/my-list/json/')).toEqual({
			kind: 'slug',
			username: 'user',
			slug: 'my-list'
		});
		expect(parseMdblistListRef('user/my-list')).toEqual({
			kind: 'slug',
			username: 'user',
			slug: 'my-list'
		});
		expect(parseMdblistListRef('2194')).toEqual({ kind: 'id', id: 2194 });
		expect(parseMdblistListRef(2194)).toEqual({ kind: 'id', id: 2194 });
	});

	it('rejects other hosts and malformed input', () => {
		expect(parseMdblistListRef('https://evil.example.com/lists/a/b')).toBeNull();
		expect(parseMdblistListRef('a/b/c')).toBeNull();
		expect(parseMdblistListRef('')).toBeNull();
		expect(parseMdblistListRef('just-a-slug')).toBeNull();
	});
});

describe('parseMdblistItem', () => {
	it('reads the list export format', () => {
		expect(
			parseMdblistItem({
				id: 1399,
				title: 'Game of Thrones',
				imdb_id: 'tt0944947',
				tvdb_id: 121361,
				mediatype: 'show',
				release_year: 2011
			})
		).toEqual({
			tmdbId: undefined,
			imdbId: 'tt0944947',
			tvdbId: 121361,
			title: 'Game of Thrones',
			year: 2011,
			mediaType: 'tv'
		});
	});

	it('uses the bare id as TMDB id only when there is no IMDB id', () => {
		expect(parseMdblistItem({ id: 603, title: 'The Matrix', mediatype: 'movie' })).toMatchObject({
			tmdbId: 603,
			mediaType: 'movie'
		});
	});

	it('prefers the explicit ids object', () => {
		expect(
			parseMdblistItem({ id: 5, title: 'X', ids: { tmdb: 27205, imdb: 'tt1375666' } })
		).toMatchObject({ tmdbId: 27205, imdbId: 'tt1375666' });
	});
});

describe('MdblistProvider', () => {
	const provider = new MdblistProvider();

	it('requires an API key for numeric list ids', () => {
		expect(provider.validateConfig({ list: 'user/list' })).toBe(true);
		expect(provider.validateConfig({ list: '2194' })).toBe(false);
		expect(provider.validateConfig({ list: '2194', apiKey: 'key' })).toBe(true);
		expect(provider.validateConfig({ list: 'https://example.com/x' })).toBe(false);
	});

	it('uses the public JSON export without an API key', async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse([
				{ id: 603, title: 'The Matrix', imdb_id: 'tt0133093', mediatype: 'movie' },
				{ id: 1399, title: 'GoT', imdb_id: 'tt0944947', mediatype: 'show' }
			])
		);
		vi.stubGlobal('fetch', fetchMock);

		const result = await provider.fetchItems({ list: 'user/my-list' }, 'movie');

		expect(fetchMock).toHaveBeenCalledWith(
			'https://mdblist.com/lists/user/my-list/json',
			expect.anything()
		);
		// Media type filtering happens in the service; the provider reports types
		expect(result.items.map((item) => item.mediaType)).toEqual(['movie', 'tv']);
	});

	it('pages through the API and filters to the requested media type', async () => {
		const movies = (start: number, count: number) =>
			Array.from({ length: count }, (_, i) => ({
				id: start + i,
				title: `Movie ${start + i}`,
				imdb_id: `tt${start + i}`,
				mediatype: 'movie'
			}));
		const fetchMock = vi.fn(async (input: string | URL | Request) => {
			const url = new URL(String(input));
			expect(url.pathname).toBe('/lists/2194/items');
			expect(url.searchParams.get('apikey')).toBe('secret');
			const offset = Number(url.searchParams.get('offset'));
			if (offset === 0) {
				return jsonResponse(
					{ movies: movies(1, 1000), shows: [{ id: 9, title: 'Show', mediatype: 'show' }] },
					{ headers: { 'X-Has-More': 'true' } }
				);
			}
			return jsonResponse(
				{ movies: movies(1001, 20), shows: [] },
				{ headers: { 'X-Has-More': 'false' } }
			);
		});
		vi.stubGlobal('fetch', fetchMock);

		const result = await provider.fetchItems(
			{ list: '2194', apiKey: 'secret', maxItems: 5000 },
			'movie'
		);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(result.error).toBeUndefined();
		expect(result.items).toHaveLength(1020);
		expect(result.items.every((item) => item.mediaType === 'movie')).toBe(true);
	});

	it('surfaces auth failures clearly', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse({ error: 'Invalid API key' }, { status: 401 }))
		);

		const result = await provider.fetchItems({ list: '2194', apiKey: 'bad' }, 'movie');

		expect(result.error).toMatch(/API key/);
	});

	it('lists the user lists for the picker', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				jsonResponse([
					{
						id: 1,
						name: 'Watchlist',
						slug: 'watchlist',
						user_name: 'me',
						mediatype: 'movie',
						items: 42
					},
					{ id: 2, name: 'Shows', mediatype: 'show' },
					{ name: 'broken' }
				])
			)
		);

		await expect(fetchMdblistUserLists('secret')).resolves.toEqual([
			{
				id: 1,
				name: 'Watchlist',
				slug: 'watchlist',
				username: 'me',
				mediaType: 'movie',
				itemCount: 42
			},
			{
				id: 2,
				name: 'Shows',
				slug: undefined,
				username: undefined,
				mediaType: 'tv',
				itemCount: undefined
			}
		]);
	});
});
