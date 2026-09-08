import type { RequestHandler } from './$types';
import {
	getBaseUrlAsync,
	getPlaybackSessionService,
	getSessionProxyService
} from '$lib/server/streaming';

function errorResponse(message: string, code: string, status: number): Response {
	return new Response(JSON.stringify({ error: message, code }), {
		status,
		headers: {
			'Content-Type': 'application/json',
			'Access-Control-Allow-Origin': '*'
		}
	});
}

/**
 * Stremio/Nuvio resolve URL for episodes.
 * Creates a playback session, then 302s to a typed play.* URL the player can sniff.
 */
export const GET: RequestHandler = async ({ params, request, url }) => {
	const { tmdbId, season, episode } = params;
	if (
		!tmdbId ||
		!season ||
		!episode ||
		!/^\d+$/.test(tmdbId) ||
		!/^\d+$/.test(season) ||
		!/^\d+$/.test(episode)
	) {
		return errorResponse('Invalid parameters', 'INVALID_PARAM', 400);
	}

	const forceRefresh =
		url.searchParams.get('refresh') === '1' || url.searchParams.get('refresh') === 'true';
	const { session, error } = await getPlaybackSessionService().createOrReuseSession({
		tmdbId: parseInt(tmdbId, 10),
		type: 'tv',
		season: parseInt(season, 10),
		episode: parseInt(episode, 10),
		forceRefresh
	});
	if (!session) {
		return errorResponse(error || 'No playable stream found', 'PLAYBACK_UNAVAILABLE', 503);
	}

	const baseUrl = await getBaseUrlAsync(request);
	const apiKey = url.searchParams.get('api_key') || request.headers.get('x-api-key') || undefined;
	return getSessionProxyService().buildStremioPlayRedirect(session, baseUrl, apiKey);
};

export const OPTIONS: RequestHandler = async () => {
	return new Response(null, {
		status: 200,
		headers: {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
			'Access-Control-Allow-Headers':
				'Range, If-Range, If-None-Match, If-Modified-Since, Content-Type'
		}
	});
};
