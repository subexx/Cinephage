import type { RequestHandler } from './$types';
import { getBaseUrlAsync } from '$lib/server/streaming';
import { STREMIO_CORS_HEADERS } from '$lib/server/stremio/constants.js';
import { parseAddonResource } from '$lib/server/stremio/ids.js';
import { getStremioAddonService } from '$lib/server/stremio/StremioAddonService.js';
import { getStremioAddonSettings } from '$lib/server/stremio/addon-settings.js';

function corsJson(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'Content-Type': 'application/json; charset=utf-8',
			'Cache-Control': 'no-store',
			...STREMIO_CORS_HEADERS
		}
	});
}

export const OPTIONS: RequestHandler = async () => {
	return new Response(null, {
		status: 204,
		headers: STREMIO_CORS_HEADERS
	});
};

export const GET: RequestHandler = async ({ params, request, locals }) => {
	const apiKey = locals.apiKey;
	if (!apiKey) {
		return corsJson({ error: 'API key required' }, 401);
	}

	const resourcePath = Array.isArray(params.resource)
		? params.resource.join('/')
		: (params.resource ?? '');
	const parsed = parseAddonResource(resourcePath);
	const addon = getStremioAddonService();
	const display = await getStremioAddonSettings();

	if (parsed.kind === 'manifest') {
		return corsJson(addon.getManifest(display.addonName));
	}

	if (parsed.kind === 'catalog') {
		return corsJson({ metas: [] });
	}

	if (parsed.kind === 'meta') {
		return corsJson({ meta: null }, 404);
	}

	if (parsed.kind === 'stream') {
		const baseUrl = await getBaseUrlAsync(request);
		const streams = await addon.getStreams(parsed.type, parsed.id, baseUrl, apiKey, display);
		return corsJson(streams);
	}

	return corsJson({ error: 'Not found' }, 404);
};

export const HEAD: RequestHandler = async (event) => {
	const response = await GET(event);
	return new Response(null, { status: response.status, headers: response.headers });
};
