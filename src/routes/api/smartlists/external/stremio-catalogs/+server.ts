/**
 * Stremio Addon Catalogs API
 * POST /api/smartlists/external/stremio-catalogs - List the catalogs an addon manifest exposes
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import {
	fetchStremioManifest,
	summarizeCatalog
} from '$lib/server/smartlists/providers/StremioCatalogProvider.js';
import { createChildLogger } from '$lib/logging';

const logger = createChildLogger({
	module: 'SmartListsStremioCatalogsApi',
	logDomain: 'monitoring'
});

const requestSchema = z.object({
	manifestUrl: z.string().min(1)
});

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { manifestUrl } = requestSchema.parse(await request.json());
		const { manifest } = await fetchStremioManifest(manifestUrl);

		return json({
			addonName: manifest.name ?? manifest.id ?? 'Stremio addon',
			catalogs: (manifest.catalogs ?? []).map(summarizeCatalog)
		});
	} catch (error) {
		if (error instanceof z.ZodError) {
			return json({ error: 'Manifest URL is required' }, { status: 400 });
		}
		const message = error instanceof Error ? error.message : 'Unknown error';
		logger.warn({ error: message }, '[StremioCatalogs API] Failed to load addon manifest');
		return json({ error: message }, { status: 400 });
	}
};
