/**
 * Stremio Catalog Provider
 *
 * Pulls items from the catalogs of any Stremio addon (AIOMetadata, Cinemeta, MDBList,
 * Trakt and streaming-catalog addons, ...). The user supplies the addon's manifest URL;
 * catalogs are fetched with the standard Stremio addon protocol:
 *
 *   {base}/manifest.json
 *   {base}/catalog/{type}/{id}.json
 *   {base}/catalog/{type}/{id}/skip={n}.json
 */

import { createChildLogger } from '$lib/logging';
import type { ExternalListProvider, ExternalListItem, ExternalListResult } from './types.js';
import { extractTmdbPosterPath, normalizeExternalMediaType, parsePositiveInt } from './types.js';

const logger = createChildLogger({ logDomain: 'monitoring' as const });

const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ITEMS_PER_CATALOG = 500;
const MAX_ITEMS_PER_CATALOG_LIMIT = 5000;
/** Hard stop on pagination in case an addon ignores `skip` and keeps returning pages */
const MAX_PAGES_PER_CATALOG = 100;

export interface StremioCatalogConfig {
	/** Addon manifest URL (…/manifest.json); stremio:// links are accepted */
	manifestUrl: string;
	/**
	 * Catalogs to pull, as "type/id" keys separated by commas or new lines.
	 * Empty = every catalog of the list's media type that needs no extra input.
	 */
	catalogs?: string;
	/** Max items fetched from each catalog */
	maxItems?: number;
}

export interface StremioCatalogExtra {
	name: string;
	isRequired?: boolean;
	options?: string[];
}

export interface StremioCatalogDefinition {
	type: string;
	id: string;
	name?: string;
	extra?: StremioCatalogExtra[];
	extraRequired?: string[];
	extraSupported?: string[];
}

export interface StremioManifest {
	id?: string;
	name?: string;
	description?: string;
	catalogs?: StremioCatalogDefinition[];
}

/** Catalog summary returned to the UI for the catalog picker */
export interface StremioCatalogSummary {
	key: string;
	type: string;
	id: string;
	name: string;
	mediaType?: 'movie' | 'tv';
	/** Needs a genre/search/etc. value, so it can't be pulled as a plain list */
	requiresExtra: boolean;
	supportsPaging: boolean;
}

interface StremioMeta {
	id?: unknown;
	imdb_id?: unknown;
	imdbId?: unknown;
	tmdb_id?: unknown;
	moviedb_id?: unknown;
	tvdb_id?: unknown;
	type?: unknown;
	name?: unknown;
	title?: unknown;
	releaseInfo?: unknown;
	year?: unknown;
	released?: unknown;
	poster?: unknown;
	description?: unknown;
	imdbRating?: unknown;
}

/**
 * Normalize a manifest URL: accept stremio://, a base URL, or the manifest itself.
 * Returns the addon base URL (without trailing slash and without /manifest.json).
 */
export function getStremioAddonBaseUrl(rawUrl: string): string | null {
	let value = rawUrl.trim();
	if (!value) return null;
	if (value.toLowerCase().startsWith('stremio://')) {
		value = 'https://' + value.slice('stremio://'.length);
	}

	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		return null;
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

	parsed.search = '';
	parsed.hash = '';
	const base = parsed
		.toString()
		.replace(/\/manifest\.json$/i, '')
		.replace(/\/+$/, '');
	return base;
}

export function catalogKey(catalog: Pick<StremioCatalogDefinition, 'type' | 'id'>): string {
	return `${catalog.type}/${catalog.id}`;
}

function getExtras(catalog: StremioCatalogDefinition): StremioCatalogExtra[] {
	return Array.isArray(catalog.extra) ? catalog.extra : [];
}

function catalogRequiresExtra(catalog: StremioCatalogDefinition): boolean {
	const required = new Set(
		Array.isArray(catalog.extraRequired) ? catalog.extraRequired : ([] as string[])
	);
	for (const extra of getExtras(catalog)) {
		if (extra.isRequired) required.add(extra.name);
	}
	required.delete('skip');
	return required.size > 0;
}

function catalogSupportsPaging(catalog: StremioCatalogDefinition): boolean {
	if (getExtras(catalog).some((extra) => extra.name === 'skip')) return true;
	return Array.isArray(catalog.extraSupported) && catalog.extraSupported.includes('skip');
}

export function summarizeCatalog(catalog: StremioCatalogDefinition): StremioCatalogSummary {
	return {
		key: catalogKey(catalog),
		type: catalog.type,
		id: catalog.id,
		name: catalog.name || catalog.id,
		mediaType: normalizeExternalMediaType(catalog.type),
		requiresExtra: catalogRequiresExtra(catalog),
		supportsPaging: catalogSupportsPaging(catalog)
	};
}

function parseCatalogKeys(value: unknown): string[] {
	if (typeof value !== 'string') return [];
	return value
		.split(/[\n,]+/)
		.map((key) => key.trim())
		.filter(Boolean);
}

async function fetchJson(url: string): Promise<unknown> {
	const response = await fetch(url, {
		headers: { Accept: 'application/json' },
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
	});
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}: ${response.statusText}`);
	}
	return response.json();
}

/**
 * Fetch and validate an addon manifest
 */
export async function fetchStremioManifest(
	manifestUrl: string
): Promise<{ baseUrl: string; manifest: StremioManifest }> {
	const baseUrl = getStremioAddonBaseUrl(manifestUrl);
	if (!baseUrl) {
		throw new Error('Invalid Stremio addon manifest URL');
	}

	const data = await fetchJson(`${baseUrl}/manifest.json`);
	if (
		typeof data !== 'object' ||
		data === null ||
		!Array.isArray((data as StremioManifest).catalogs)
	) {
		throw new Error('URL did not return a Stremio addon manifest with catalogs');
	}

	const manifest = data as StremioManifest;
	manifest.catalogs = (manifest.catalogs ?? []).filter(
		(catalog): catalog is StremioCatalogDefinition =>
			typeof catalog?.type === 'string' && typeof catalog?.id === 'string'
	);
	return { baseUrl, manifest };
}

/**
 * Parse a Stremio meta object into an external list item
 */
export function parseStremioMeta(meta: StremioMeta): ExternalListItem | null {
	if (typeof meta !== 'object' || meta === null) return null;

	let tmdbId = parsePositiveInt(meta.tmdb_id) ?? parsePositiveInt(meta.moviedb_id);
	let imdbId: string | undefined;
	let tvdbId = parsePositiveInt(meta.tvdb_id);

	for (const candidate of [meta.imdb_id, meta.imdbId]) {
		if (typeof candidate === 'string' && /^tt\d+$/i.test(candidate.trim())) {
			imdbId = candidate.trim();
			break;
		}
	}

	// Stremio IDs: "tt123", "tmdb:123", "tmdb:movie:123", "tvdb:123", "kitsu:1", "mal:1", …
	if (typeof meta.id === 'string') {
		const id = meta.id.trim();
		const imdbMatch = id.match(/^(tt\d+)/i);
		if (imdbMatch) {
			imdbId ??= imdbMatch[1];
		} else {
			const [prefix, ...rest] = id.split(':');
			const numeric = parsePositiveInt(rest[rest.length - 1]);
			if (prefix.toLowerCase() === 'tmdb') tmdbId ??= numeric;
			if (prefix.toLowerCase() === 'tvdb') tvdbId ??= numeric;
		}
	}

	const title =
		(typeof meta.name === 'string' && meta.name.trim()) ||
		(typeof meta.title === 'string' && meta.title.trim()) ||
		undefined;

	if (!tmdbId && !imdbId && !tvdbId && !title) {
		return null;
	}

	let year: number | undefined;
	for (const candidate of [meta.year, meta.releaseInfo, meta.released]) {
		const match = String(candidate ?? '').match(/(\d{4})/);
		if (match) {
			year = Number(match[1]);
			break;
		}
	}

	const rating = typeof meta.imdbRating === 'string' ? parseFloat(meta.imdbRating) : NaN;

	return {
		tmdbId,
		imdbId,
		tvdbId,
		title: title ?? imdbId ?? `TMDB ${tmdbId ?? tvdbId}`,
		year,
		posterPath: extractTmdbPosterPath(meta.poster) ?? null,
		overview: typeof meta.description === 'string' ? meta.description : undefined,
		voteAverage: Number.isFinite(rating) ? rating : undefined,
		mediaType: normalizeExternalMediaType(meta.type)
	};
}

export class StremioCatalogProvider implements ExternalListProvider {
	readonly type = 'stremio-catalog';
	readonly name = 'Stremio Addon Catalog';

	validateConfig(config: unknown): boolean {
		if (typeof config !== 'object' || config === null) return false;
		const cfg = config as Partial<StremioCatalogConfig>;
		return typeof cfg.manifestUrl === 'string' && getStremioAddonBaseUrl(cfg.manifestUrl) !== null;
	}

	async fetchItems(config: unknown, mediaType: 'movie' | 'tv' | ''): Promise<ExternalListResult> {
		const cfg = config as StremioCatalogConfig;
		const maxItems = Math.min(
			Math.max(Number(cfg.maxItems) || DEFAULT_MAX_ITEMS_PER_CATALOG, 1),
			MAX_ITEMS_PER_CATALOG_LIMIT
		);

		try {
			const { baseUrl, manifest } = await fetchStremioManifest(cfg.manifestUrl);
			const catalogs = this.selectCatalogs(manifest.catalogs ?? [], cfg.catalogs, mediaType);

			if (catalogs.length === 0) {
				throw new Error(
					mediaType
						? `No ${mediaType === 'movie' ? 'movie' : 'series'} catalogs selected or available in this addon`
						: 'No catalogs selected or available in this addon'
				);
			}

			logger.info(
				{
					addon: manifest.name,
					catalogs: catalogs.map(catalogKey),
					maxItems,
					mediaType: mediaType || 'all'
				},
				'[StremioCatalogProvider] Fetching addon catalogs'
			);

			const items: ExternalListItem[] = [];
			let failedCount = 0;
			let totalCount = 0;
			const catalogErrors: string[] = [];

			for (const catalog of catalogs) {
				try {
					const metas = await this.fetchCatalogMetas(baseUrl, catalog, maxItems);
					totalCount += metas.length;
					for (const meta of metas) {
						const item = parseStremioMeta(meta as StremioMeta);
						if (!item) {
							failedCount++;
							continue;
						}
						// Catalog type is authoritative when the meta doesn't say
						item.mediaType ??= normalizeExternalMediaType(catalog.type);
						items.push(item);
					}
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					catalogErrors.push(`${catalog.name || catalogKey(catalog)}: ${message}`);
					logger.warn(
						{ catalog: catalogKey(catalog), error: message },
						'[StremioCatalogProvider] Failed to fetch catalog'
					);
				}
			}

			// Only fail the whole fetch when every catalog failed
			if (catalogErrors.length === catalogs.length) {
				throw new Error(catalogErrors.join('; '));
			}

			logger.info(
				{ itemCount: items.length, failedCount, catalogErrors: catalogErrors.length },
				'[StremioCatalogProvider] Fetched addon catalogs'
			);

			return { items, totalCount, failedCount };
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error(
				{ error: errorMessage, manifestUrl: getStremioAddonBaseUrl(cfg.manifestUrl ?? '') },
				'[StremioCatalogProvider] Failed to fetch addon catalogs'
			);
			return { items: [], totalCount: 0, failedCount: 0, error: errorMessage };
		}
	}

	private selectCatalogs(
		available: StremioCatalogDefinition[],
		requested: unknown,
		mediaType: 'movie' | 'tv' | ''
	): StremioCatalogDefinition[] {
		const keys = parseCatalogKeys(requested);
		const matchesType = (catalog: StremioCatalogDefinition) =>
			!mediaType || normalizeExternalMediaType(catalog.type) === mediaType;

		if (keys.length > 0) {
			const byKey = new Map(available.map((catalog) => [catalogKey(catalog), catalog]));
			const selected: StremioCatalogDefinition[] = [];
			for (const key of keys) {
				const catalog = byKey.get(key);
				if (!catalog) {
					logger.warn({ key }, '[StremioCatalogProvider] Selected catalog not in manifest');
					continue;
				}
				if (catalogRequiresExtra(catalog)) {
					logger.warn({ key }, '[StremioCatalogProvider] Catalog requires extra input, skipping');
					continue;
				}
				if (matchesType(catalog)) selected.push(catalog);
			}
			return selected;
		}

		return available.filter((catalog) => !catalogRequiresExtra(catalog) && matchesType(catalog));
	}

	private async fetchCatalogMetas(
		baseUrl: string,
		catalog: StremioCatalogDefinition,
		maxItems: number
	): Promise<unknown[]> {
		const type = encodeURIComponent(catalog.type);
		const id = encodeURIComponent(catalog.id);
		const paging = catalogSupportsPaging(catalog);
		const metas: unknown[] = [];
		const seen = new Set<string>();

		for (let page = 0; page < MAX_PAGES_PER_CATALOG && metas.length < maxItems; page++) {
			const url =
				page === 0
					? `${baseUrl}/catalog/${type}/${id}.json`
					: `${baseUrl}/catalog/${type}/${id}/skip=${metas.length}.json`;

			const data = (await fetchJson(url)) as { metas?: unknown };
			const pageMetas = Array.isArray(data?.metas) ? data.metas : [];

			let added = 0;
			for (const meta of pageMetas) {
				const metaId =
					typeof (meta as StremioMeta)?.id === 'string'
						? ((meta as StremioMeta).id as string)
						: JSON.stringify(meta);
				if (seen.has(metaId)) continue;
				seen.add(metaId);
				metas.push(meta);
				added++;
				if (metas.length >= maxItems) break;
			}

			// Stop when paging is unsupported, the catalog is exhausted, or it repeats itself
			if (!paging || pageMetas.length === 0 || added === 0) break;
		}

		return metas;
	}
}
