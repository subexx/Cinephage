/**
 * Stale Missing Unmonitor Task
 *
 * Auto-unmonitors library items that have been missing for a long time and
 * repeatedly failed content searches. Never deletes library entries.
 *
 * Movies: monitored && !hasFile && age >= N && failedAttempts >= M
 * Series: monitored && episodeFileCount === 0 && age >= N && failedAttempts >= M
 *
 * Runs daily (default: every 24 hours), like historyCleanup.
 */

import { db } from '$lib/server/db/index.js';
import { movies, series, episodes, monitoringHistory } from '$lib/server/db/schema.js';
import { and, eq, gte, lte, or, isNull } from 'drizzle-orm';
import { createChildLogger } from '$lib/logging/index.js';
import type { TaskResult } from '../MonitoringScheduler.js';
import type { TaskExecutionContext } from '$lib/server/tasks/TaskExecutionContext.js';
import { isStaleMissingCandidate } from '../staleMissingEligibility.js';

const logger = createChildLogger({ module: 'StaleMissingUnmonitorTask', logDomain: 'monitoring' });

export interface StaleMissingUnmonitorSettings {
	staleMissingUnmonitorEnabled: boolean;
	staleMissingMinAgeDays: number;
	staleMissingMinFailedSearches: number;
}

/**
 * Execute stale-missing unmonitor task.
 */
export async function executeStaleMissingUnmonitorTask(
	ctx: TaskExecutionContext | null,
	settings: StaleMissingUnmonitorSettings
): Promise<TaskResult> {
	const executedAt = new Date();
	const taskHistoryId = ctx?.historyId;
	logger.info({ taskHistoryId }, '[StaleMissingUnmonitorTask] Starting');

	let itemsProcessed = 0;
	const itemsGrabbed = 0;
	let errors = 0;

	try {
		ctx?.checkCancelled();

		if (!settings.staleMissingUnmonitorEnabled) {
			logger.info('[StaleMissingUnmonitorTask] Disabled — skipping');
			return {
				taskType: 'staleMissingUnmonitor',
				itemsProcessed: 0,
				itemsGrabbed: 0,
				errors: 0,
				executedAt
			};
		}

		const minAgeDays = settings.staleMissingMinAgeDays;
		const minFailed = settings.staleMissingMinFailedSearches;
		const cutoff = new Date(executedAt);
		cutoff.setUTCDate(cutoff.getUTCDate() - minAgeDays);
		const cutoffIso = cutoff.toISOString();

		// --- Movies ---
		const movieCandidates = await db
			.select({
				id: movies.id,
				title: movies.title,
				added: movies.added,
				failedContentSearchAttempts: movies.failedContentSearchAttempts
			})
			.from(movies)
			.where(
				and(
					eq(movies.monitored, true),
					eq(movies.hasFile, false),
					gte(movies.failedContentSearchAttempts, minFailed),
					lte(movies.added, cutoffIso)
				)
			);

		for (const movie of movieCandidates) {
			ctx?.checkCancelled();

			if (
				!isStaleMissingCandidate({
					added: movie.added,
					attempts: movie.failedContentSearchAttempts,
					minAgeDays,
					minFailed,
					now: executedAt
				})
			) {
				continue;
			}

			try {
				await db.update(movies).set({ monitored: false }).where(eq(movies.id, movie.id));

				const message = `Unmonitored stale missing movie "${movie.title}" after ${movie.failedContentSearchAttempts} failed searches and age >= ${minAgeDays} days`;
				await db.insert(monitoringHistory).values({
					taskHistoryId,
					taskType: 'stale_missing_unmonitor',
					movieId: movie.id,
					status: 'unmonitored',
					errorMessage: message,
					executedAt: executedAt.toISOString()
				});

				itemsProcessed++;
				logger.info({ movieId: movie.id, title: movie.title }, message);
			} catch (err) {
				errors++;
				logger.error(
					{ err, movieId: movie.id },
					'[StaleMissingUnmonitorTask] Failed to unmonitor movie'
				);
			}
		}

		ctx?.checkCancelled();

		// --- Series (zero files only) ---
		const seriesCandidates = await db
			.select({
				id: series.id,
				title: series.title,
				added: series.added,
				failedContentSearchAttempts: series.failedContentSearchAttempts,
				episodeFileCount: series.episodeFileCount
			})
			.from(series)
			.where(
				and(
					eq(series.monitored, true),
					or(eq(series.episodeFileCount, 0), isNull(series.episodeFileCount)),
					gte(series.failedContentSearchAttempts, minFailed),
					lte(series.added, cutoffIso)
				)
			);

		for (const show of seriesCandidates) {
			ctx?.checkCancelled();

			if (
				!isStaleMissingCandidate({
					added: show.added,
					attempts: show.failedContentSearchAttempts,
					minAgeDays,
					minFailed,
					now: executedAt
				})
			) {
				continue;
			}

			try {
				await db.update(series).set({ monitored: false }).where(eq(series.id, show.id));

				// Also unmonitor monitored episodes that still have no file
				await db
					.update(episodes)
					.set({ monitored: false })
					.where(
						and(
							eq(episodes.seriesId, show.id),
							eq(episodes.monitored, true),
							eq(episodes.hasFile, false)
						)
					);

				const message = `Unmonitored stale missing series "${show.title}" after ${show.failedContentSearchAttempts} failed searches and age >= ${minAgeDays} days (zero episode files)`;
				await db.insert(monitoringHistory).values({
					taskHistoryId,
					taskType: 'stale_missing_unmonitor',
					seriesId: show.id,
					status: 'unmonitored',
					errorMessage: message,
					executedAt: executedAt.toISOString()
				});

				itemsProcessed++;
				logger.info({ seriesId: show.id, title: show.title }, message);
			} catch (err) {
				errors++;
				logger.error(
					{ err, seriesId: show.id },
					'[StaleMissingUnmonitorTask] Failed to unmonitor series'
				);
			}
		}

		logger.info(
			{ itemsProcessed, errors, minAgeDays, minFailed },
			'[StaleMissingUnmonitorTask] Completed'
		);

		return {
			taskType: 'staleMissingUnmonitor',
			itemsProcessed,
			itemsGrabbed,
			errors,
			executedAt
		};
	} catch (error) {
		logger.error({ err: error }, '[StaleMissingUnmonitorTask] Task failed');
		throw error;
	}
}
