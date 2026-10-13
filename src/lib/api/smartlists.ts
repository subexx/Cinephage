import type {
	SmartListCreateRequest,
	SmartListPreviewRequest,
	SmartListExternalPreviewRequest,
	SmartListItemsAction
} from '$lib/validation/schemas.js';

import { apiGet, apiPost, apiPut, apiDelete } from './client.js';

export async function getSmartLists() {
	return apiGet('/api/smartlists');
}

export async function getSmartList(id: string) {
	return apiGet(`/api/smartlists/${id}`);
}

export async function createSmartList(payload: SmartListCreateRequest) {
	return apiPost('/api/smartlists', payload);
}

export async function updateSmartList(id: string, payload: Partial<SmartListCreateRequest>) {
	return apiPut(`/api/smartlists/${id}`, payload);
}

export async function deleteSmartList(id: string) {
	return apiDelete(`/api/smartlists/${id}`);
}

export async function refreshSmartList(id: string) {
	return apiPost(`/api/smartlists/${id}/refresh`);
}

export async function getSmartListRefreshStatus(id: string) {
	return apiGet(`/api/smartlists/${id}/refresh`);
}

interface SmartListRefreshStatus {
	refreshing: boolean;
	lastRefreshStatus: string | null;
	lastRefreshError: string | null;
}

const REFRESH_POLL_INTERVAL_MS = 3000;

/**
 * Refresh a smart list and wait for it to finish. External lists refresh in the
 * background on the server, so this polls until that run completes.
 * Resolves with the final status; `onBackground` fires once if it went to the background.
 */
export async function refreshSmartListAndWait(
	id: string,
	options: { onBackground?: () => void } = {}
): Promise<{ status: string; errorMessage?: string }> {
	const result = (await refreshSmartList(id)) as {
		status?: string;
		error?: string;
		errorMessage?: string;
	};

	if (result?.status !== 'started' && result?.status !== 'running') {
		return {
			status: result?.status ?? 'success',
			errorMessage: result?.errorMessage ?? result?.error
		};
	}

	options.onBackground?.();

	for (;;) {
		await new Promise((resolve) => setTimeout(resolve, REFRESH_POLL_INTERVAL_MS));
		const status = (await getSmartListRefreshStatus(id)) as unknown as SmartListRefreshStatus;
		if (!status.refreshing) {
			return {
				status: status.lastRefreshStatus ?? 'success',
				errorMessage: status.lastRefreshError ?? undefined
			};
		}
	}
}

export async function refreshAllSmartLists() {
	return apiPost('/api/smartlists/refresh-all');
}

export async function getSmartListPresets() {
	return apiGet('/api/smartlists/presets');
}

export async function getSmartListPreview(payload: SmartListPreviewRequest) {
	return apiPost('/api/smartlists/preview', payload);
}

export async function getExternalListPreview(payload: SmartListExternalPreviewRequest) {
	return apiPost('/api/smartlists/external/preview', payload);
}

export async function testExternalList(payload: Record<string, unknown>) {
	return apiPost('/api/smartlists/external/test', payload);
}

export async function getStremioAddonCatalogs(manifestUrl: string) {
	return apiPost('/api/smartlists/external/stremio-catalogs', { manifestUrl });
}

export async function getMdblistUserLists(apiKey: string) {
	return apiPost('/api/smartlists/external/mdblist-lists', { apiKey });
}

export async function getSmartListHelpers(params?: Record<string, string>) {
	return apiGet('/api/smartlists/helpers', params);
}

export async function addSmartListItems(listId: string, payload: SmartListItemsAction) {
	return apiPost(`/api/smartlists/${listId}/items`, payload);
}
