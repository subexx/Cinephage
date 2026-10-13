/**
 * MDBList User Lists API
 * POST /api/smartlists/external/mdblist-lists - List the lists owned by an MDBList API key
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { fetchMdblistUserLists } from '$lib/server/smartlists/providers/MdblistProvider.js';
import { createChildLogger } from '$lib/logging';

const logger = createChildLogger({
	module: 'SmartListsMdblistListsApi',
	logDomain: 'monitoring'
});

const requestSchema = z.object({
	apiKey: z.string().min(1)
});

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { apiKey } = requestSchema.parse(await request.json());
		const lists = await fetchMdblistUserLists(apiKey);
		return json({ lists });
	} catch (error) {
		if (error instanceof z.ZodError) {
			return json({ error: 'MDBList API key is required' }, { status: 400 });
		}
		const message = error instanceof Error ? error.message : 'Unknown error';
		logger.warn({ error: message }, '[MdblistLists API] Failed to load MDBList lists');
		return json({ error: message }, { status: 400 });
	}
};
