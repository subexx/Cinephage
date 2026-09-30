/**
 * Missing Content Task
 *
 * Searches for monitored movies and episodes that don't have files yet.
 * Runs periodically (default: daily) to find and grab missing content.
 */

import { db } from '$lib/server/db/index.js';
import { monitoringHistory, episodes, movies, series } from '$lib/server/db/schema.js';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { monitoringSearchService } from '../search/MonitoringSearchService.js';
import { createChildLogger } from '$lib/logging/index.js';
import type { TaskResult } from '../MonitoringScheduler.js';
import type { TaskExecutionContext } from '$lib/server/tasks/TaskExecutionContext.js';

const logger = createChildLogger({ module: 'MissingContentTask', logDomain: 'monitoring' });

interface MissingContentTaskOptions {
	/**
	 * When true, bypass per-item cooldown checks.
	 * Used for manual "run now" executions.
	 */
	ignoreCooldown?: boolean;
	/**
	 * Per-item cooldown in hours for this run.
	 * Typically derived from scheduled interval.
	 */
	cooldownHours?: number;
}

type SearchItemStatus = 'grabbed' | 'error' | 'found' | 'no_results';

function resolveSearchStatus(item: {
	grabbed?: boolean;
	grabbedRelease?: string | null;
	error?: string | null;
	releasesFound: number;
}): SearchItemStatus {
	if (item.grabbed || item.grabbedRelease) return 'grabbed';
	if (item.error) return 'error';
	if (item.releasesFound > 0) return 'found';
	return 'no_results';
}

async function updateMovieFailedAttempts(movieId: string, status: SearchItemStatus): Promise<void> {
	if (status === 'no_results') {
		await db
			.update(movies)
			.set({
				failedContentSearchAttempts: sql`${movies.failedContentSearchAttempts} + 1`
			})
			.where(eq(movies.id, movieId));
	} else if (status === 'grabbed' || status === 'found') {
		await db.update(movies).set({ failedContentSearchAttempts: 0 }).where(eq(movies.id, movieId));
	}
}

/**
 * Execute missing content search task
 * @param ctx - Execution context for cancellation support and activity tracking
 */
export async function executeMissingContentTask(
	ctx: TaskExecutionContext | null,
	options: MissingContentTaskOptions = {}
): Promise<TaskResult> {
	const executedAt = new Date();
	const taskHistoryId = ctx?.historyId;
	logger.info({ taskHistoryId }, '[MissingContentTask] Starting missing content search');

	let itemsProcessed = 0;
	let itemsGrabbed = 0;
	let errors = 0;

	try {
		// Check for cancellation before starting
		ctx?.checkCancelled();

		// Search for missing movies
		logger.info('[MissingContentTask] Searching for missing movies');
		const movieResults = await monitoringSearchService.searchMissingMovies(ctx?.abortSignal, {
			ignoreCooldown: options.ignoreCooldown,
			cooldownHours: options.cooldownHours
		});

		itemsProcessed += movieResults.summary.searched;
		itemsGrabbed += movieResults.summary.grabbed;
		errors += movieResults.summary.errors;

		logger.info(
			{
				searched: movieResults.summary.searched,
				grabbed: movieResults.summary.grabbed,
				errors: movieResults.summary.errors,
				rejectionBreakdown: movieResults.summary.rejectionBreakdown
			},
			'[MissingContentTask] Missing movies search completed'
		);

		// Record history for each movie (with cancellation checks)
		if (ctx) {
			for await (const item of ctx.iterate(movieResults.items)) {
				// Skipped items ARE recorded: without this, eligibility-skipped movies
				// (availability gates, cooldowns) are invisible in monitoring history
				// and look like "never searched" to users debugging matching.
				if (!item.searched && item.skipped) {
					await db.insert(monitoringHistory).values({
						taskHistoryId,
						taskType: 'missing',
						movieId: item.itemType === 'movie' ? item.itemId : undefined,
						episodeId: item.itemType === 'episode' ? item.itemId : undefined,
						status: 'skipped',
						errorMessage: item.skipReason,
						executedAt: executedAt.toISOString()
					});
					continue;
				}

				const status = resolveSearchStatus(item);

				await db.insert(monitoringHistory).values({
					taskHistoryId,
					taskType: 'missing',
					movieId: item.itemType === 'movie' ? item.itemId : undefined,
					status,
					releasesFound: item.releasesFound,
					releaseGrabbed: item.grabbedRelease,
					queueItemId: item.queueItemId,
					isUpgrade: false,
					errorMessage: item.error,
					executedAt: executedAt.toISOString()
				});

				if (item.itemType === 'movie') {
					await updateMovieFailedAttempts(item.itemId, status);
				}
			}
		} else {
			// No context - record without cancellation checks
			for (const item of movieResults.items) {
				if (!item.searched && item.skipped) continue;

				const status = resolveSearchStatus({
					grabbed: item.grabbed,
					error: item.error,
					releasesFound: item.releasesFound
				});

				await db.insert(monitoringHistory).values({
					taskHistoryId,
					taskType: 'missing',
					movieId: item.itemType === 'movie' ? item.itemId : undefined,
					status,
					releasesFound: item.releasesFound,
					releaseGrabbed: item.grabbedRelease,
					queueItemId: item.queueItemId,
					isUpgrade: false,
					errorMessage: item.error,
					executedAt: executedAt.toISOString()
				});

				if (item.itemType === 'movie') {
					await updateMovieFailedAttempts(item.itemId, status);
				}
			}
		}

		// Check for cancellation before episode search
		ctx?.checkCancelled();

		// Search for missing episodes
		logger.info('[MissingContentTask] Searching for missing episodes');
		const episodeResults = await monitoringSearchService.searchMissingEpisodes(ctx?.abortSignal, {
			ignoreCooldown: options.ignoreCooldown,
			cooldownHours: options.cooldownHours
		});

		itemsProcessed += episodeResults.summary.searched;
		itemsGrabbed += episodeResults.summary.grabbed;
		errors += episodeResults.summary.errors;

		logger.info(
			{
				searched: episodeResults.summary.searched,
				grabbed: episodeResults.summary.grabbed,
				errors: episodeResults.summary.errors,
				rejectionBreakdown: episodeResults.summary.rejectionBreakdown
			},
			'[MissingContentTask] Missing episodes search completed'
		);

		// Batch-fetch seriesId for episode items so history rows are correctly linked
		const episodeIds = episodeResults.items
			.filter((i) => i.itemType === 'episode')
			.map((i) => i.itemId);
		const episodeSeriesMap =
			episodeIds.length > 0
				? new Map(
						(
							await db
								.select({ id: episodes.id, seriesId: episodes.seriesId })
								.from(episodes)
								.where(inArray(episodes.id, episodeIds))
								.all()
						).map((e) => [e.id, e.seriesId])
					)
				: new Map<string, string>();

		/** Per-series outcomes for this run (searched episodes only). */
		const seriesRunStats = new Map<string, { hadNoResults: boolean; hadGrab: boolean }>();

		const recordEpisodeSeriesStats = (episodeId: string, status: SearchItemStatus) => {
			const seriesId = episodeSeriesMap.get(episodeId);
			if (!seriesId) return;
			const stats = seriesRunStats.get(seriesId) ?? { hadNoResults: false, hadGrab: false };
			if (status === 'grabbed') stats.hadGrab = true;
			if (status === 'no_results') stats.hadNoResults = true;
			seriesRunStats.set(seriesId, stats);
		};

		// Record history for each episode (with cancellation checks)
		if (ctx) {
			for await (const item of ctx.iterate(episodeResults.items)) {
				if (!item.searched && item.skipped) continue;

				const status = resolveSearchStatus(item);

				await db.insert(monitoringHistory).values({
					taskHistoryId,
					taskType: 'missing',
					episodeId: item.itemType === 'episode' ? item.itemId : undefined,
					seriesId:
						item.itemType === 'episode'
							? (episodeSeriesMap.get(item.itemId) ?? undefined)
							: undefined,
					status,
					releasesFound: item.releasesFound,
					releaseGrabbed: item.grabbedRelease,
					queueItemId: item.queueItemId,
					isUpgrade: false,
					errorMessage: item.error,
					executedAt: executedAt.toISOString()
				});

				if (item.itemType === 'episode') {
					recordEpisodeSeriesStats(item.itemId, status);
				}
			}
		} else {
			for (const item of episodeResults.items) {
				if (!item.searched && item.skipped) continue;

				const status = resolveSearchStatus(item);

				await db.insert(monitoringHistory).values({
					taskHistoryId,
					taskType: 'missing',
					episodeId: item.itemType === 'episode' ? item.itemId : undefined,
					seriesId:
						item.itemType === 'episode'
							? (episodeSeriesMap.get(item.itemId) ?? undefined)
							: undefined,
					status,
					releasesFound: item.releasesFound,
					releaseGrabbed: item.grabbedRelease,
					queueItemId: item.queueItemId,
					isUpgrade: false,
					errorMessage: item.error,
					executedAt: executedAt.toISOString()
				});

				if (item.itemType === 'episode') {
					recordEpisodeSeriesStats(item.itemId, status);
				}
			}
		}

		// Update series-level failedContentSearchAttempts once per series for this run
		for (const [seriesId, stats] of seriesRunStats) {
			if (stats.hadGrab) {
				await db
					.update(series)
					.set({ failedContentSearchAttempts: 0 })
					.where(eq(series.id, seriesId));
			} else if (stats.hadNoResults) {
				await db
					.update(series)
					.set({
						failedContentSearchAttempts: sql`${series.failedContentSearchAttempts} + 1`
					})
					.where(
						and(
							eq(series.id, seriesId),
							or(eq(series.episodeFileCount, 0), isNull(series.episodeFileCount))
						)
					);
			}
		}

		logger.info(
			{
				totalProcessed: itemsProcessed,
				totalGrabbed: itemsGrabbed,
				totalErrors: errors
			},
			'[MissingContentTask] Missing content task completed'
		);

		return {
			taskType: 'missing',
			itemsProcessed,
			itemsGrabbed,
			errors,
			executedAt
		};
	} catch (error) {
		logger.error({ err: error }, '[MissingContentTask] Task failed');
		throw error;
	}
}
