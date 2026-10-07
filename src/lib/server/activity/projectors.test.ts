import { describe, expect, it } from 'vitest';

import { isActiveActivity, type UnifiedActivity } from '$lib/types/activity';
import { buildActivitySummary } from './activity-filters.js';
import { mapQueueStatus, projectQueueActivity } from './projectors.js';

function projectWithQueueStatus(status: string): UnifiedActivity {
	return projectQueueActivity(
		{
			id: `queue-${status}`,
			title: 'Some.Movie.2026.1080p.WEB-DL-GRP',
			status,
			progress: 1,
			completedAt: '2026-10-01T00:00:00.000Z',
			lastAttemptAt: '2026-10-01T01:00:00.000Z',
			errorMessage: status === 'importing' ? 'Import interrupted — retrying' : null
		},
		{ mediaType: 'movie', mediaId: '', mediaTitle: 'Some Movie', mediaYear: 2026 }
	);
}

describe('mapQueueStatus', () => {
	it('maps pre-transfer and transfer states to downloading', () => {
		expect(mapQueueStatus('queued')).toBe('downloading');
		expect(mapQueueStatus('downloading')).toBe('downloading');
		expect(mapQueueStatus('stalled')).toBe('downloading');
	});

	it('maps completed downloads to awaiting-import, and active import distinctly', () => {
		expect(mapQueueStatus('completed')).toBe('completed');
		expect(mapQueueStatus('postprocessing')).toBe('importing');
		expect(mapQueueStatus('importing')).toBe('importing');
	});

	it('keeps terminal and torrent-specific states distinct', () => {
		expect(mapQueueStatus('seeding')).toBe('seeding');
		expect(mapQueueStatus('paused')).toBe('paused');
		expect(mapQueueStatus('failed')).toBe('failed');
		expect(mapQueueStatus('imported')).toBe('imported');
		expect(mapQueueStatus('seeding-imported')).toBe('imported');
		expect(mapQueueStatus('removed')).toBe('removed');
	});
});

describe('post-download queue items remain active but are not "downloading"', () => {
	it.each([
		['completed', 'completed'],
		['postprocessing', 'importing'],
		['importing', 'importing']
	] as const)('%s items map to %s and stay in the active scope', (queueStatus, activityStatus) => {
		const activity = projectWithQueueStatus(queueStatus);

		expect(activity.status).toBe(activityStatus);
		expect(isActiveActivity(activity)).toBe(true);
		expect(activity.queueStatus).toBe(queueStatus);
	});

	it('surfaces import interruption reasons on importing activities', () => {
		const activity = projectWithQueueStatus('importing');
		expect(activity.statusReason).toBe('Import interrupted — retrying');
	});
});

describe('buildActivitySummary counts importing separately from downloading', () => {
	it('does not inflate downloadingCount with finished transfers awaiting import', () => {
		const activities = [
			projectWithQueueStatus('downloading'),
			projectWithQueueStatus('completed'),
			projectWithQueueStatus('importing')
		];

		const summary = buildActivitySummary(activities);

		expect(summary.totalCount).toBe(3);
		expect(summary.downloadingCount).toBe(1);
		expect(summary.importingCount).toBe(2);
	});
});
