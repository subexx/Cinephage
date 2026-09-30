import type { DesiredQuality } from '$lib/types/library.js';

/** Default movie copies: 4K plus 1080p, kept as independent files. */
export const DEFAULT_MOVIE_DESIRED_QUALITIES: DesiredQuality[] = ['2160p', '1080p'];

/**
 * Use the caller's list when they picked two or more tiers; otherwise keep
 * 4K + 1080p. Empty/omitted add payloads must not fall back to single-best.
 */
export function movieDesiredQualitiesOrDefault(
	requested?: DesiredQuality[] | null
): DesiredQuality[] {
	if (requested && requested.length >= 2) return requested;
	return [...DEFAULT_MOVIE_DESIRED_QUALITIES];
}
