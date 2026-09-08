import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { requireAdmin } from '$lib/server/auth/authorization.js';
import {
	getStremioAddonSettings,
	saveStremioAddonSettings
} from '$lib/server/stremio/addon-settings.js';
import { STREMIO_FORMAT_PRESETS } from '$lib/shared/stremio-format.js';

const formatSchema = z.object({
	name: z.string().min(1).max(2000),
	description: z.string().min(1).max(4000)
});

const settingsSchema = z.object({
	addonName: z.string().trim().min(1).max(80),
	format: formatSchema
});

export const GET: RequestHandler = async (event) => {
	const authError = requireAdmin(event);
	if (authError) return authError;
	const settings = await getStremioAddonSettings();
	return json({ settings, presets: STREMIO_FORMAT_PRESETS });
};

export const PUT: RequestHandler = async (event) => {
	const authError = requireAdmin(event);
	if (authError) return authError;
	const parsed = settingsSchema.safeParse(await event.request.json());
	if (!parsed.success) {
		return json({ error: 'Invalid addon settings' }, { status: 400 });
	}
	const settings = await saveStremioAddonSettings(parsed.data);
	return json({ settings });
};
