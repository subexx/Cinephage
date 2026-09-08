export type StremioContentType = 'movie' | 'series';

export interface ParsedStremioId {
	type: StremioContentType;
	imdbId: string | null;
	tmdbId: number | null;
	season?: number;
	episode?: number;
}

export interface ParsedCatalogExtra {
	search?: string;
	skip: number;
}

export type ParsedAddonResource =
	| { kind: 'manifest' }
	| { kind: 'catalog'; type: StremioContentType; catalogId: string; extra: ParsedCatalogExtra }
	| { kind: 'meta'; type: StremioContentType; id: string }
	| { kind: 'stream'; type: StremioContentType; id: string }
	| { kind: 'unknown' };

const IMDB_PATTERN = /^(?:tt)?(\d+)$/i;
const TMDB_PATTERN = /^tmdb:(\d+)(?::(\d+):(\d+))?$/i;
const EPISODE_SUFFIX = /:(\d+):(\d+)$/;

export function normalizeImdbId(raw: string | null | undefined): string | null {
	if (!raw) return null;
	const match = raw.trim().match(IMDB_PATTERN);
	if (!match) return null;
	return `tt${match[1]}`;
}

export function imdbLookupValues(raw: string): string[] {
	const normalized = normalizeImdbId(raw);
	if (!normalized) return [];
	const digits = normalized.slice(2);
	return [...new Set([normalized, digits, raw.trim()])];
}

export function toStremioMovieId(imdbId: string | null | undefined, tmdbId: number): string {
	return normalizeImdbId(imdbId) ?? `tmdb:${tmdbId}`;
}

export function toStremioSeriesId(imdbId: string | null | undefined, tmdbId: number): string {
	return toStremioMovieId(imdbId, tmdbId);
}

export function toStremioEpisodeId(
	seriesId: string,
	season: number,
	episode: number
): string {
	return `${seriesId}:${season}:${episode}`;
}

export function parseStremioId(type: string, rawId: string): ParsedStremioId | null {
	if (type !== 'movie' && type !== 'series') return null;
	const id = decodeURIComponent(rawId).trim();
	if (!id) return null;

	const tmdb = id.match(TMDB_PATTERN);
	if (tmdb) {
		return {
			type,
			imdbId: null,
			tmdbId: Number.parseInt(tmdb[1], 10),
			season: type === 'series' && tmdb[2] ? Number.parseInt(tmdb[2], 10) : undefined,
			episode: type === 'series' && tmdb[3] ? Number.parseInt(tmdb[3], 10) : undefined
		};
	}

	let season: number | undefined;
	let episode: number | undefined;
	let base = id;
	const episodeMatch = id.match(EPISODE_SUFFIX);
	if (episodeMatch) {
		base = id.slice(0, -episodeMatch[0].length);
		if (type === 'series') {
			season = Number.parseInt(episodeMatch[1], 10);
			episode = Number.parseInt(episodeMatch[2], 10);
		}
	}

	const imdbId = normalizeImdbId(base);
	if (!imdbId) return null;

	return { type, imdbId, tmdbId: null, season, episode };
}

export function parseCatalogExtra(raw: string | undefined): ParsedCatalogExtra {
	if (!raw) return { skip: 0 };
	const params = new URLSearchParams(raw);
	const search = params.get('search')?.trim() || undefined;
	const skipRaw = params.get('skip');
	const skip = skipRaw ? Number.parseInt(skipRaw, 10) : 0;
	return {
		search,
		skip: Number.isFinite(skip) && skip > 0 ? skip : 0
	};
}

export function parseAddonResource(resourcePath: string): ParsedAddonResource {
	const trimmed = resourcePath.replace(/^\/+|\/+$/g, '').replace(/\.json$/i, '');
	if (!trimmed) return { kind: 'unknown' };

	const parts = trimmed.split('/');
	const [resource, type, ...rest] = parts;

	if (resource === 'manifest' && parts.length === 1) {
		return { kind: 'manifest' };
	}

	if (type !== 'movie' && type !== 'series') {
		return { kind: 'unknown' };
	}

	if (resource === 'catalog' && rest.length >= 1) {
		const catalogId = rest[0];
		const extra = parseCatalogExtra(rest.slice(1).join('/'));
		return { kind: 'catalog', type, catalogId, extra };
	}

	if ((resource === 'meta' || resource === 'stream') && rest.length >= 1) {
		const id = rest.join('/');
		return { kind: resource, type, id };
	}

	return { kind: 'unknown' };
}

export function parseStremioApiKeyFromPath(pathname: string): string | null {
	const match = pathname.match(/^\/stremio\/([^/]+)(?:\/|$)/);
	if (!match) return null;
	try {
		return decodeURIComponent(match[1]);
	} catch {
		return match[1];
	}
}

export function isStremioAddonPath(pathname: string): boolean {
	return pathname === '/stremio' || pathname.startsWith('/stremio/');
}

export function sanitizeLikeQuery(query: string): string {
	return query.replace(/[%_]/g, ' ').replace(/\s+/g, ' ').trim();
}
