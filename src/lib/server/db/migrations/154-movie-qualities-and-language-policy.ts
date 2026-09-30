import type Database from 'better-sqlite3';
import type { MigrationDefinition } from '../migration-helpers.js';
import { createChildLogger } from '$lib/logging';
import {
	ENGLISH_ORIGINAL_PROFILE_ID,
	ENGLISH_ORIGINAL_PROFILE_NAME,
	PREFERRED_AUDIO_LANGUAGE
} from '$lib/shared/preferred-language.js';

const logger = createChildLogger({ logDomain: 'system' as const });

const DEFAULT_QUALITIES_JSON = JSON.stringify(['2160p', '1080p']);

/** v2 audio: English preferred, original as soft fallback (preferOriginal). */
const ENGLISH_ORIGINAL_AUDIO_JSON = JSON.stringify({
	preferOriginal: true,
	languages: [PREFERRED_AUDIO_LANGUAGE],
	mode: 'prefer'
});

/** English subtitle cutoff requirement (v2 shape). */
const ENGLISH_SUBTITLES_JSON = JSON.stringify([
	{ tag: PREFERRED_AUDIO_LANGUAGE, variant: 'regular', accessibility: 'any' }
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

function tableExists(sqlite: Database.Database, table: string): boolean {
	const row = sqlite
		.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
		.get(table) as { name: string } | undefined;
	return !!row;
}

/**
 * Default every movie to 4K + 1080p copies, seed the English-then-original
 * language profile (v2 audio/subtitles shape), set it as the instance default,
 * and assign it to movies and series.
 *
 * Note: original_language columns already exist from the language-system reset
 * (v140); subtitle_settings was dropped in v152 — default authority is
 * language_settings.default_profile_id.
 */
export const migration_v154: MigrationDefinition = {
	version: 154,
	name: 'movie_qualities_and_english_original_language',
	apply: (sqlite: Database.Database) => {
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
		sqlite
			.prepare(
				`INSERT INTO language_profiles (
					id, name, audio, subtitles, cutoff_rank, upgrades_allowed, minimum_score, created_at, updated_at
				) VALUES (?, ?, ?, ?, 0, 1, 60, ?, ?)
				ON CONFLICT(id) DO UPDATE SET
					name = excluded.name,
					audio = excluded.audio,
					subtitles = excluded.subtitles,
					cutoff_rank = excluded.cutoff_rank,
					upgrades_allowed = excluded.upgrades_allowed,
					minimum_score = excluded.minimum_score,
					updated_at = excluded.updated_at`
			)
			.run(
				ENGLISH_ORIGINAL_PROFILE_ID,
				ENGLISH_ORIGINAL_PROFILE_NAME,
				ENGLISH_ORIGINAL_AUDIO_JSON,
				ENGLISH_SUBTITLES_JSON,
				now,
				now
			);

		if (tableExists(sqlite, 'language_settings')) {
			sqlite
				.prepare(
					`UPDATE language_settings SET default_profile_id = ?, updated_at = ? WHERE id = 'singleton'`
				)
				.run(ENGLISH_ORIGINAL_PROFILE_ID, now);
			const updated = sqlite
				.prepare(`SELECT changes() as c`)
				.get() as { c: number };
			if (updated.c === 0) {
				sqlite
					.prepare(
						`INSERT INTO language_settings (id, default_profile_id, updated_at)
						 VALUES ('singleton', ?, ?)
						 ON CONFLICT(id) DO UPDATE SET
							default_profile_id = excluded.default_profile_id,
							updated_at = excluded.updated_at`
					)
					.run(ENGLISH_ORIGINAL_PROFILE_ID, now);
			}
		}

		const moviesAssigned = sqlite
			.prepare('UPDATE movies SET language_profile_id = ?')
			.run(ENGLISH_ORIGINAL_PROFILE_ID).changes;
		const seriesAssigned = sqlite
			.prepare('UPDATE series SET language_profile_id = ?')
			.run(ENGLISH_ORIGINAL_PROFILE_ID).changes;

		logger.info(
			{ moviesUpdated, moviesAssigned, seriesAssigned },
			'[migration v154] Defaulted movie qualities and English+Original language profile'
		);
	}
};
