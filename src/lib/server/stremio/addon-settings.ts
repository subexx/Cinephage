import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { settings } from '$lib/server/db/schema';
import {
	DEFAULT_STREMIO_ADDON_SETTINGS,
	DEFAULT_STREMIO_FORMAT,
	type StremioAddonDisplaySettings,
	type StremioFormatConfig
} from '$lib/shared/stremio-format.js';

export const STREMIO_ADDON_SETTINGS_KEY = 'stremio_addon';

function parseSettings(raw: string | undefined): StremioAddonDisplaySettings {
	if (!raw) return { ...DEFAULT_STREMIO_ADDON_SETTINGS, format: { ...DEFAULT_STREMIO_FORMAT } };
	try {
		const parsed = JSON.parse(raw) as Partial<StremioAddonDisplaySettings>;
		const addonName =
			typeof parsed.addonName === 'string' && parsed.addonName.trim()
				? parsed.addonName.trim()
				: DEFAULT_STREMIO_ADDON_SETTINGS.addonName;
		const format: StremioFormatConfig = {
			name:
				typeof parsed.format?.name === 'string' && parsed.format.name.trim()
					? parsed.format.name
					: DEFAULT_STREMIO_FORMAT.name,
			description:
				typeof parsed.format?.description === 'string' && parsed.format.description.trim()
					? parsed.format.description
					: DEFAULT_STREMIO_FORMAT.description
		};
		return { addonName, format };
	} catch {
		return { ...DEFAULT_STREMIO_ADDON_SETTINGS, format: { ...DEFAULT_STREMIO_FORMAT } };
	}
}

export async function getStremioAddonSettings(): Promise<StremioAddonDisplaySettings> {
	const row = await db
		.select({ value: settings.value })
		.from(settings)
		.where(eq(settings.key, STREMIO_ADDON_SETTINGS_KEY))
		.get();
	return parseSettings(row?.value);
}

export async function saveStremioAddonSettings(
	next: StremioAddonDisplaySettings
): Promise<StremioAddonDisplaySettings> {
	const value = JSON.stringify(next);
	await db
		.insert(settings)
		.values({ key: STREMIO_ADDON_SETTINGS_KEY, value })
		.onConflictDoUpdate({
			target: settings.key,
			set: { value }
		});
	return next;
}
