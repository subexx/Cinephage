/**
 * MDBList Provider
 *
 * Pulls items from MDBList lists.
 * - With an API key: public lists, your own (including private) lists, by ID or user/slug,
 *   via https://api.mdblist.com with limit/offset paging.
 * - Without an API key: public lists by URL or user/slug via the public JSON export.
 */

import { createChildLogger } from '$lib/logging';
import type { ExternalListProvider, ExternalListItem, ExternalListResult } from './types.js';
import { normalizeExternalMediaType, parsePositiveInt } from './types.js';

const logger = createChildLogger({ logDomain: 'monitoring' as const });

const API_BASE = 'https://api.mdblist.com';
const PUBLIC_BASE = 'https://mdblist.com';
const REQUEST_TIMEOUT_MS = 30_000;
const PAGE_SIZE = 1000;
const DEFAULT_MAX_ITEMS = 1000;
const MAX_ITEMS_LIMIT = 10_000;

export interface MdblistConfig {
	/** MDBList API key (Preferences → API). Needed for private lists and list IDs. */
	apiKey?: string;
	/** List URL, "username/list-slug", or numeric list ID */
	list: string;
	/** Max items to pull from the list */
	maxItems?: number;
}

export type MdblistListRef =
	{ kind: 'id'; id: number } | { kind: 'slug'; username: string; slug: string };

/** Summary of one of the user's lists, for the list picker */
export interface MdblistListSummary {
	id: number;
	name: string;
	slug?: string;
	username?: string;
	mediaType?: 'movie' | 'tv';
	itemCount?: number;
}

/**
 * Parse a list reference from a URL, "user/slug" or a numeric ID
 */
export function parseMdblistListRef(raw: unknown): MdblistListRef | null {
	if (typeof raw !== 'string') {
		const id = parsePositiveInt(raw);
		return id ? { kind: 'id', id } : null;
	}
	const value = raw.trim();
	if (!value) return null;

	const id = parsePositiveInt(value);
	if (id) return { kind: 'id', id };

	let path = value;
	if (/^https?:\/\//i.test(value)) {
		try {
			const url = new URL(value);
			if (!/(^|\.)mdblist\.com$/i.test(url.hostname)) return null;
			path = url.pathname;
		} catch {
			return null;
		}
	}

	const segments = path
		.split('/')
		.map((segment) => segment.trim())
		.filter(Boolean);
	// Accept "/lists/user/slug", "/lists/user/slug/json", and "user/slug"
	if (segments[0]?.toLowerCase() === 'lists') segments.shift();
	if (segments[segments.length - 1]?.toLowerCase() === 'json') segments.pop();

	if (segments.length === 1) {
		const listId = parsePositiveInt(segments[0]);
		return listId ? { kind: 'id', id: listId } : null;
	}
	if (segments.length !== 2) return null;

	return {
		kind: 'slug',
		username: decodeURIComponent(segments[0]),
		slug: decodeURIComponent(segments[1])
	};
}

function listPath(ref: MdblistListRef): string {
	return ref.kind === 'id'
		? `/lists/${ref.id}`
		: `/lists/${encodeURIComponent(ref.username)}/${encodeURIComponent(ref.slug)}`;
}

async function fetchMdblist(url: string): Promise<{ data: unknown; hasMore: boolean | null }> {
	const response = await fetch(url, {
		headers: { Accept: 'application/json' },
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
	});
	if (response.status === 401 || response.status === 403) {
		throw new Error('MDBList rejected the request (check the API key and list privacy)');
	}
	if (response.status === 404) {
		throw new Error('MDBList list not found');
	}
	if (response.status === 429) {
		throw new Error('MDBList rate limit reached, try again later');
	}
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}: ${response.statusText}`);
	}
	const hasMoreHeader = response.headers.get('x-has-more');
	return {
		data: await response.json(),
		hasMore: hasMoreHeader === null ? null : hasMoreHeader.toLowerCase() === 'true'
	};
}

/**
 * Flatten an MDBList items payload: a plain array, or { movies: [], shows: [] }
 */
function extractRawItems(data: unknown): Array<Record<string, unknown>> {
	if (Array.isArray(data)) return data as Array<Record<string, unknown>>;
	if (typeof data !== 'object' || data === null) return [];

	const obj = data as Record<string, unknown>;
	if (typeof obj.error === 'string') {
		throw new Error(`MDBList: ${obj.error}`);
	}
	const items: Array<Record<string, unknown>> = [];
	for (const [key, fallbackType] of [
		['movies', 'movie'],
		['shows', 'show'],
		['items', undefined]
	] as const) {
		const group = obj[key];
		if (!Array.isArray(group)) continue;
		for (const entry of group) {
			if (typeof entry !== 'object' || entry === null) continue;
			const record = entry as Record<string, unknown>;
			items.push(
				fallbackType && !record.mediatype ? { ...record, mediatype: fallbackType } : record
			);
		}
	}
	return items;
}

/**
 * Parse one MDBList item
 */
export function parseMdblistItem(raw: Record<string, unknown>): ExternalListItem | null {
	const ids = (typeof raw.ids === 'object' && raw.ids !== null ? raw.ids : {}) as Record<
		string,
		unknown
	>;

	const imdbCandidate = ids.imdb ?? raw.imdb_id ?? raw.imdbid;
	const imdbId =
		typeof imdbCandidate === 'string' && /^tt\d+$/i.test(imdbCandidate.trim())
			? imdbCandidate.trim()
			: undefined;
	const tvdbId = parsePositiveInt(ids.tvdb ?? raw.tvdb_id ?? raw.tvdbid);
	// The bare `id` field is the TMDB ID in MDBList exports; only trust it when there is
	// no IMDB ID to resolve from, since explicit TMDB fields are unambiguous.
	const tmdbId =
		parsePositiveInt(ids.tmdb ?? raw.tmdb_id ?? raw.tmdbid) ??
		(imdbId ? undefined : parsePositiveInt(raw.id));

	const title = typeof raw.title === 'string' ? raw.title.trim() : '';
	if (!tmdbId && !imdbId && !tvdbId && !title) return null;

	const year = parsePositiveInt(raw.release_year ?? raw.year);

	return {
		tmdbId,
		imdbId,
		tvdbId,
		title: title || imdbId || `TMDB ${tmdbId ?? tvdbId}`,
		year,
		mediaType: normalizeExternalMediaType(raw.mediatype ?? raw.media_type ?? raw.type)
	};
}

/**
 * List the API key owner's lists (for the list picker)
 */
export async function fetchMdblistUserLists(apiKey: string): Promise<MdblistListSummary[]> {
	const key = apiKey.trim();
	if (!key) throw new Error('MDBList API key is required');

	const { data } = await fetchMdblist(`${API_BASE}/lists/user?apikey=${encodeURIComponent(key)}`);
	const rows = Array.isArray(data)
		? data
		: Array.isArray((data as { lists?: unknown })?.lists)
			? (data as { lists: unknown[] }).lists
			: [];
	if (!Array.isArray(data) && typeof (data as { error?: unknown })?.error === 'string') {
		throw new Error(`MDBList: ${(data as { error: string }).error}`);
	}

	const lists: MdblistListSummary[] = [];
	for (const row of rows) {
		if (typeof row !== 'object' || row === null) continue;
		const record = row as Record<string, unknown>;
		const id = parsePositiveInt(record.id);
		if (!id) continue;
		lists.push({
			id,
			name: typeof record.name === 'string' ? record.name : `List ${id}`,
			slug: typeof record.slug === 'string' ? record.slug : undefined,
			username:
				typeof record.user_name === 'string'
					? record.user_name
					: typeof record.username === 'string'
						? record.username
						: undefined,
			mediaType: normalizeExternalMediaType(record.mediatype),
			itemCount: parsePositiveInt(record.items)
		});
	}
	return lists;
}

export class MdblistProvider implements ExternalListProvider {
	readonly type = 'mdblist';
	readonly name = 'MDBList';

	validateConfig(config: unknown): boolean {
		if (typeof config !== 'object' || config === null) return false;
		const cfg = config as Partial<MdblistConfig>;
		const ref = parseMdblistListRef(cfg.list);
		if (!ref) return false;
		// Numeric IDs are only addressable through the API
		return ref.kind === 'slug' || (typeof cfg.apiKey === 'string' && cfg.apiKey.trim() !== '');
	}

	async fetchItems(config: unknown, mediaType: 'movie' | 'tv' | ''): Promise<ExternalListResult> {
		const cfg = config as MdblistConfig;
		const ref = parseMdblistListRef(cfg.list);
		const apiKey = typeof cfg.apiKey === 'string' ? cfg.apiKey.trim() : '';
		const maxItems = Math.min(
			Math.max(Number(cfg.maxItems) || DEFAULT_MAX_ITEMS, 1),
			MAX_ITEMS_LIMIT
		);

		try {
			if (!ref) {
				throw new Error('Enter an MDBList list URL, "username/list-name", or list ID');
			}

			const rawItems = apiKey
				? await this.fetchViaApi(ref, apiKey, mediaType, maxItems)
				: await this.fetchPublicJson(ref, maxItems);

			const items: ExternalListItem[] = [];
			let failedCount = 0;
			for (const raw of rawItems) {
				const item = parseMdblistItem(raw);
				if (item) items.push(item);
				else failedCount++;
			}

			logger.info(
				{
					list: ref.kind === 'id' ? ref.id : `${ref.username}/${ref.slug}`,
					viaApi: !!apiKey,
					itemCount: items.length,
					failedCount
				},
				'[MdblistProvider] Fetched MDBList list'
			);

			return { items, totalCount: rawItems.length, failedCount };
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error({ error: errorMessage }, '[MdblistProvider] Failed to fetch MDBList list');
			return { items: [], totalCount: 0, failedCount: 0, error: errorMessage };
		}
	}

	private async fetchViaApi(
		ref: MdblistListRef,
		apiKey: string,
		mediaType: 'movie' | 'tv' | '',
		maxItems: number
	): Promise<Array<Record<string, unknown>>> {
		const items: Array<Record<string, unknown>> = [];

		for (let offset = 0; items.length < maxItems; offset += PAGE_SIZE) {
			const params = new URLSearchParams({
				apikey: apiKey,
				limit: String(PAGE_SIZE),
				offset: String(offset)
			});
			const { data, hasMore } = await fetchMdblist(
				`${API_BASE}${listPath(ref)}/items?${params.toString()}`
			);
			const page = extractRawItems(data);
			items.push(...page);

			const morePages = hasMore ?? page.length >= PAGE_SIZE;
			if (page.length === 0 || !morePages) break;
		}

		const typed = mediaType
			? items.filter((item) => {
					const type = normalizeExternalMediaType(item.mediatype ?? item.media_type);
					return !type || type === mediaType;
				})
			: items;
		return typed.slice(0, maxItems);
	}

	private async fetchPublicJson(
		ref: MdblistListRef,
		maxItems: number
	): Promise<Array<Record<string, unknown>>> {
		if (ref.kind === 'id') {
			throw new Error('An MDBList API key is required to load a list by ID');
		}
		const { data } = await fetchMdblist(`${PUBLIC_BASE}${listPath(ref)}/json`);
		return extractRawItems(data).slice(0, maxItems);
	}
}
