/**
 * Smart List Refresh API
 * POST /api/smartlists/[id]/refresh - Manually refresh a smart list
 * GET  /api/smartlists/[id]/refresh - Refresh status (for polling a background refresh)
 *
 * External lists refresh in the background (202): a large addon or MDBList list can
 * take minutes, which would otherwise time out the request. TMDB Discover lists are
 * quick and still refresh inline.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSmartListService } from '$lib/server/smartlists/index.js';
import { RefreshInProgressError } from '$lib/server/smartlists/SmartListService.js';

export const POST: RequestHandler = async ({ params }) => {
	const service = getSmartListService();

	const list = await service.getSmartList(params.id);
	if (!list) {
		return json({ error: 'Smart list not found' }, { status: 404 });
	}

	if (list.listSourceType !== 'tmdb-discover') {
		const started = service.startRefreshInBackground(params.id, 'manual');
		return json(
			{ smartListId: params.id, status: started ? 'started' : 'running' },
			{ status: 202 }
		);
	}

	try {
		const result = await service.refreshSmartList(params.id, 'manual');
		return json(result);
	} catch (error) {
		if (error instanceof RefreshInProgressError) {
			return json({ smartListId: params.id, status: 'running' }, { status: 202 });
		}
		const message = error instanceof Error ? error.message : 'Unknown error';
		return json({ error: message }, { status: 500 });
	}
};

export const GET: RequestHandler = async ({ params }) => {
	const service = getSmartListService();

	const list = await service.getSmartList(params.id);
	if (!list) {
		return json({ error: 'Smart list not found' }, { status: 404 });
	}

	return json({
		smartListId: list.id,
		refreshing: service.isRefreshing(list.id),
		lastRefreshTime: list.lastRefreshTime,
		lastRefreshStatus: list.lastRefreshStatus,
		lastRefreshError: list.lastRefreshError,
		cachedItemCount: list.cachedItemCount
	});
};
