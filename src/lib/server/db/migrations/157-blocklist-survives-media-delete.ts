import type { MigrationDefinition } from '../migration-helpers.js';
import { columnExists } from '../migration-helpers.js';
import { createChildLogger } from '$lib/logging';

const logger = createChildLogger({ logDomain: 'system' as const });

/**
 * Keep release blocklist entries when their movie/series is deleted.
 *
 * blocklist.movie_id / series_id cascade on delete, so deleting a movie wiped
 * every release the user had blocklisted for it; when the movie came back
 * (request app, smart list) the same bad release was grabbed again. Entries now
 * also record the TMDB id, and a BEFORE DELETE trigger detaches them (id set to
 * NULL, tmdb_id kept) before the cascade can run. Lookups match detached entries
 * by tmdb_id + media_type.
 */
export const migration_v157: MigrationDefinition = {
	version: 157,
	name: 'blocklist_survives_media_delete',
	apply: (sqlite) => {
		if (!columnExists(sqlite, 'blocklist', 'tmdb_id')) {
			sqlite.prepare(`ALTER TABLE blocklist ADD COLUMN tmdb_id INTEGER`).run();
			logger.info('[SchemaSync] Added tmdb_id column to blocklist');
		}
		if (!columnExists(sqlite, 'blocklist', 'media_type')) {
			sqlite.prepare(`ALTER TABLE blocklist ADD COLUMN media_type TEXT`).run();
			logger.info('[SchemaSync] Added media_type column to blocklist');
		}

		// Backfill the TMDB id for entries still attached to library items
		sqlite
			.prepare(
				`UPDATE blocklist SET
					tmdb_id = (SELECT tmdb_id FROM movies WHERE movies.id = blocklist.movie_id),
					media_type = 'movie'
				 WHERE movie_id IS NOT NULL AND tmdb_id IS NULL`
			)
			.run();
		sqlite
			.prepare(
				`UPDATE blocklist SET
					tmdb_id = (SELECT tmdb_id FROM series WHERE series.id = blocklist.series_id),
					media_type = 'tv'
				 WHERE series_id IS NOT NULL AND tmdb_id IS NULL`
			)
			.run();

		sqlite
			.prepare(
				`CREATE TRIGGER IF NOT EXISTS blocklist_detach_on_movie_delete
				 BEFORE DELETE ON movies
				 BEGIN
					UPDATE blocklist SET movie_id = NULL, tmdb_id = OLD.tmdb_id, media_type = 'movie'
					WHERE movie_id = OLD.id;
				 END`
			)
			.run();
		sqlite
			.prepare(
				`CREATE TRIGGER IF NOT EXISTS blocklist_detach_on_series_delete
				 BEFORE DELETE ON series
				 BEGIN
					UPDATE blocklist SET series_id = NULL, episode_ids = NULL,
						tmdb_id = OLD.tmdb_id, media_type = 'tv'
					WHERE series_id = OLD.id;
				 END`
			)
			.run();
		sqlite
			.prepare(`CREATE INDEX IF NOT EXISTS idx_blocklist_tmdb ON blocklist (tmdb_id, media_type)`)
			.run();
		logger.info('[SchemaSync] Blocklist entries now survive movie/series deletion');
	}
};
