import type Database from 'better-sqlite3';
import type { MigrationDefinition } from '../migration-helpers.js';
import { columnExists } from '../migration-helpers.js';
import { createChildLogger } from '$lib/logging';
import {
	ENGLISH_ORIGINAL_PROFILE_ID,
	ENGLISH_ORIGINAL_PROFILE_NAME
} from '$lib/shared/preferred-language.js';

const logger = createChildLogger({ logDomain: 'system' as const });

const DEFAULT_QUALITIES_JSON = JSON.stringify(['2160p', '1080p']);
const ENGLISH_ORIGINAL_LANGUAGES_JSON = JSON.stringify([
	{
		code: 'en',
		forced: false,
		hearingImpaired: false,
		excludeHi: false,
		isCutoff: true
	},
	{
		code: 'original',
		forced: false,
		hearingImpaired: false,
		excludeHi: false,
		isCutoff: false
	}
]);

function parseDesired(raw: string | null): string[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw) as unknown;
		return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
	} catch {
		return [];
	}
}

/**
 * Default every movie to 4K + 1080p copies, store original language columns,
 * and assign the English-then-original language profile to movies and series.
 */
export const migration_v138: MigrationDefinition = {
	version: 138,
	name: 'movie_qualities_and_english_original_language',
	apply: (sqlite: Database.Database) => {
		if (!columnExists(sqlite, 'movies', 'original_language')) {
			sqlite.prepare(`ALTER TABLE movies ADD COLUMN original_language TEXT`).run();
			logger.info('[SchemaSync] Added original_language column to movies');
		}
		if (!columnExists(sqlite, 'series', 'original_language')) {
			sqlite.prepare(`ALTER TABLE series ADD COLUMN original_language TEXT`).run();
			logger.info('[SchemaSync] Added original_language column to series');
		}

		const movieRows = sqlite.prepare('SELECT id, desired_qualities FROM movies').all() as Array<{
			id: string;
			desired_qualities: string | null;
		}>;
		const updateMovieQualities = sqlite.prepare(
			'UPDATE movies SET desired_qualities = ? WHERE id = ?'
		);
		let moviesUpdated = 0;
		sqlite.transaction(() => {
			for (const row of movieRows) {
				const desired = parseDesired(row.desired_qualities);
				if (desired.includes('2160p') && desired.includes('1080p')) continue;
				updateMovieQualities.run(DEFAULT_QUALITIES_JSON, row.id);
				moviesUpdated++;
			}
		})();

		const now = new Date().toISOString();
		sqlite.prepare(`UPDATE language_profiles SET is_default = 0`).run();
		sqlite
			.prepare(
				`INSERT INTO language_profiles (
					id, name, languages, cutoff_index, upgrades_allowed, minimum_score, is_default, created_at, updated_at
				) VALUES (?, ?, ?, 0, 1, 60, 1, ?, ?)
				ON CONFLICT(id) DO UPDATE SET
					name = excluded.name,
					languages = excluded.languages,
					cutoff_index = excluded.cutoff_index,
					upgrades_allowed = excluded.upgrades_allowed,
					is_default = 1,
					updated_at = excluded.updated_at`
			)
			.run(
				ENGLISH_ORIGINAL_PROFILE_ID,
				ENGLISH_ORIGINAL_PROFILE_NAME,
				ENGLISH_ORIGINAL_LANGUAGES_JSON,
				now,
				now
			);

		const moviesAssigned = sqlite
			.prepare('UPDATE movies SET language_profile_id = ?')
			.run(ENGLISH_ORIGINAL_PROFILE_ID).changes;
		const seriesAssigned = sqlite
			.prepare('UPDATE series SET language_profile_id = ?')
			.run(ENGLISH_ORIGINAL_PROFILE_ID).changes;

		sqlite
			.prepare(
				`INSERT INTO subtitle_settings (key, value) VALUES ('default_language_profile_id', ?)
				 ON CONFLICT(key) DO UPDATE SET value = excluded.value`
			)
			.run(ENGLISH_ORIGINAL_PROFILE_ID);

		logger.info(
			{ moviesUpdated, moviesAssigned, seriesAssigned },
			'[migration v138] Defaulted movie qualities and English+Original language profile'
		);
	}
};
