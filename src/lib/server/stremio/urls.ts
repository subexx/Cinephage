export function withApiKey(url: string, apiKey: string): string {
	const separator = url.includes('?') ? '&' : '?';
	return `${url}${separator}api_key=${encodeURIComponent(apiKey)}`;
}

/**
 * Stremio/Nuvio need a `.m3u8` path so the player treats the URL as HLS/media.
 * Jellyfin .strm files keep using the extension-less session route.
 */
export function buildMovieSessionUrl(baseUrl: string, tmdbId: number, apiKey: string): string {
	return withApiKey(`${baseUrl}/api/streaming/session/movie/${tmdbId}/master.m3u8`, apiKey);
}

export function buildEpisodeSessionUrl(
	baseUrl: string,
	tmdbId: number,
	season: number,
	episode: number,
	apiKey: string
): string {
	return withApiKey(
		`${baseUrl}/api/streaming/session/tv/${tmdbId}/${season}/${episode}/master.m3u8`,
		apiKey
	);
}

/** Append a filename fragment so players can sniff container when the path has no extension. */
export function withFilenameHint(url: string, filename: string | undefined): string {
	if (!filename) return url;
	const safe = filename.replace(/[/\\#?]/g, '_');
	if (!safe.includes('.')) return url;
	return `${url}#${encodeURIComponent(safe)}`;
}

export function buildMovieLibraryFileUrl(
	baseUrl: string,
	fileId: string,
	apiKey: string,
	filename?: string
): string {
	return withFilenameHint(
		withApiKey(`${baseUrl}/api/streaming/library/movie/${fileId}`, apiKey),
		filename
	);
}

export function buildEpisodeLibraryFileUrl(
	baseUrl: string,
	fileId: string,
	apiKey: string,
	filename?: string
): string {
	return withFilenameHint(
		withApiKey(`${baseUrl}/api/streaming/library/episode/${fileId}`, apiKey),
		filename
	);
}

export function buildStremioManifestUrl(baseUrl: string, apiKey: string): string {
	return `${baseUrl.replace(/\/$/, '')}/stremio/${encodeURIComponent(apiKey)}/manifest.json`;
}

export function buildStremioDeepLink(manifestUrl: string): string {
	return manifestUrl.replace(/^https?:\/\//i, 'stremio://');
}

export function isStrmPath(relativePath: string | null | undefined): boolean {
	return relativePath?.toLowerCase().endsWith('.strm') ?? false;
}

const WEB_READY_EXTENSIONS = new Set(['.mp4', '.m4v', '.webm', '.mov']);

export function isWebReadyPath(relativePath: string | null | undefined): boolean {
	if (!relativePath || isStrmPath(relativePath)) return true;
	const dot = relativePath.lastIndexOf('.');
	if (dot < 0) return false;
	return WEB_READY_EXTENSIONS.has(relativePath.slice(dot).toLowerCase());
}
