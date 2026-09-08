import type { RequestHandler } from '@sveltejs/kit';
import {
	getBaseUrlAsync,
	getPlaybackSessionStore,
	getSessionProxyService
} from '$lib/server/streaming';

async function handlePlay(
	token: string,
	extension: string,
	request: Request,
	url: URL
): Promise<Response> {
	const session = getPlaybackSessionStore().getSession(token);
	if (!session) {
		return new Response(JSON.stringify({ error: 'Streaming session not found' }), {
			status: 404,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const baseUrl = await getBaseUrlAsync(request);
	const apiKey = url.searchParams.get('api_key') || request.headers.get('x-api-key') || undefined;
	return getSessionProxyService().renderStremioPlay(session, extension, baseUrl, apiKey, request);
}

export function createPlayHandlers(extension: string): {
	GET: RequestHandler;
	HEAD: RequestHandler;
	OPTIONS: RequestHandler;
} {
	return {
		GET: async ({ params, request, url }) => {
			const token = (params as { token: string }).token;
			return handlePlay(token, extension, request, url);
		},
		HEAD: async ({ params, request }) => {
			const token = (params as { token: string }).token;
			const session = getPlaybackSessionStore().getSession(token);
			if (!session) return new Response(null, { status: 404 });
			return getSessionProxyService().renderHeadResponse(session, request);
		},
		OPTIONS: async () =>
			new Response(null, {
				status: 200,
				headers: {
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
					'Access-Control-Allow-Headers':
						'Range, If-Range, If-None-Match, If-Modified-Since, Content-Type'
				}
			})
	};
}
