import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { monitoringScheduler } from '$lib/server/monitoring/MonitoringScheduler.js';
import { createChildLogger } from '$lib/logging';
import { requireAdmin } from '$lib/server/auth/authorization.js';

const logger = createChildLogger({
	module: 'MonitoringSearchStaleMissingUnmonitorApi',
	logDomain: 'monitoring'
});

/**
 * POST /api/monitoring/search/stale-missing-unmonitor
 * Manually trigger stale-missing unmonitor
 */
export const POST: RequestHandler = async (event) => {
	const authError = requireAdmin(event);
	if (authError) return authError;

	try {
		const result = await monitoringScheduler.runStaleMissingUnmonitor();

		return json({
			success: true,
			message: 'Stale missing unmonitor completed',
			result
		});
	} catch (error) {
		logger.error(
			'[API] Failed to run stale missing unmonitor',
			error instanceof Error ? error : undefined
		);
		return json(
			{
				success: false,
				error: 'Failed to run stale missing unmonitor',
				message: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};
