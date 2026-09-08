import type { PageServerLoad } from './$types';
import { getExtractionCacheManager } from '$lib/server/streaming/nzb/extraction/ExtractionCacheManager';
import { getRecoverableApiKeyByType } from '$lib/server/auth';
import { getBaseUrlAsync } from '$lib/server/streaming';
import { buildStremioDeepLink, buildStremioManifestUrl } from '$lib/server/stremio/urls.js';
import { getStremioAddonSettings } from '$lib/server/stremio/addon-settings.js';
import {
	STREMIO_FORMAT_PRESET_LABELS,
	STREMIO_FORMAT_PRESETS
} from '$lib/shared/stremio-format.js';

export const load: PageServerLoad = async ({ request }) => {
	const cacheManager = getExtractionCacheManager();
	const [stats, streamingApiKey, baseUrl, addonSettings] = await Promise.all([
		cacheManager.getStats(),
		getRecoverableApiKeyByType('streaming'),
		getBaseUrlAsync(request),
		getStremioAddonSettings()
	]);

	const manifestUrl =
		streamingApiKey && baseUrl ? buildStremioManifestUrl(baseUrl, streamingApiKey) : null;

	return {
		cacheStats: {
			fileCount: stats.fileCount,
			totalSizeMB: Math.round(stats.totalSizeBytes / 1024 / 1024),
			expiredCount: stats.expiredCount
		},
		settings: {
			retentionHours: 48,
			maxCacheSizeGB: 0
		},
		stremio: {
			manifestUrl,
			installUrl: manifestUrl ? buildStremioDeepLink(manifestUrl) : null,
			hasStreamingKey: Boolean(streamingApiKey),
			addonName: addonSettings.addonName,
			format: addonSettings.format,
			presets: STREMIO_FORMAT_PRESETS,
			presetLabels: STREMIO_FORMAT_PRESET_LABELS
		}
	};
};
