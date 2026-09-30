import type Database from 'better-sqlite3';
import type { MigrationDefinition } from '../migration-helpers.js';
import { ensureColumn, tableExists } from '../migration-helpers.js';
import { createChildLogger } from '$lib/logging';

const logger = createChildLogger({ logDomain: 'system' as const });

/**
 * Version 155: Stale-missing unmonitor lifecycle.
 *
 * - Adds `failed_content_search_attempts` to movies and series (series-level
 *   counter for zero-file shows). Incremented by MissingContentTask on
 *   no_results; cleared on grab/found, import, or remonitor.
 * - Seeds monitoring_settings keys for the daily StaleMissingUnmonitorTask.
 *
 * Never auto-deletes library entries — only unmonitors when age + failures
 * thresholds are met while still missing.
 *
 * Idempotent: guarded by ensureColumn / INSERT OR IGNORE.
 */
export const migration_v155: MigrationDefinition = {
	version: 155,
	name: 'stale_missing_unmonitor',
	apply: (sqlite: Database.Database) => {
		for (const table of ['movies', 'series']) {
			if (!tableExists(sqlite, table)) continue;
			ensureColumn(
				sqlite,
				table,
				'failed_content_search_attempts',
				'"failed_content_search_attempts" integer DEFAULT 0'
			);
		}

		if (tableExists(sqlite, 'monitoring_settings')) {
			const seeds: Array<[string, string]> = [
				['stale_missing_unmonitor_enabled', 'true'],
				['stale_missing_min_age_days', '365'],
				['stale_missing_min_failed_searches', '5']
			];
			const insert = sqlite.prepare(
				`INSERT OR IGNORE INTO monitoring_settings (key, value) VALUES (?, ?)`
			);
			for (const [key, value] of seeds) {
				insert.run(key, value);
			}
		}

		logger.info(
			'[migration v155] Added failed_content_search_attempts columns and stale-missing settings'
		);
	}
};
