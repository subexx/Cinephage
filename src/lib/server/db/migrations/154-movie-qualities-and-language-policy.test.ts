import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migration_v154 } from './154-movie-qualities-and-language-policy.js';
import { ENGLISH_ORIGINAL_PROFILE_ID } from '$lib/shared/preferred-language.js';

describe('migration v154', () => {
	it('defaults movie qualities and seeds the English + Original language profile', () => {
		const sqlite = new Database(':memory:');
		sqlite.exec(`
			CREATE TABLE movies (
				id text PRIMARY KEY,
				desired_qualities text,
				language_profile_id text
			);
			CREATE TABLE series (
				id text PRIMARY KEY,
				language_profile_id text
			);
			CREATE TABLE language_profiles (
				id text PRIMARY KEY,
				name text NOT NULL,
				audio text NOT NULL,
				subtitles text NOT NULL,
				cutoff_rank integer,
				upgrades_allowed integer DEFAULT 1,
				minimum_score integer DEFAULT 70,
				created_at text,
				updated_at text
			);
			CREATE TABLE language_settings (
				id text PRIMARY KEY,
				default_profile_id text,
				metadata_locale text DEFAULT 'en-US' NOT NULL,
				region text DEFAULT 'US' NOT NULL,
				unknown_subtitle_policy text DEFAULT 'und' NOT NULL,
				auto_sync_subtitles integer DEFAULT 1 NOT NULL,
				prefer_original_title integer DEFAULT 0 NOT NULL,
				updated_at text
			);
			INSERT INTO language_settings (id, default_profile_id) VALUES ('singleton', NULL);
			INSERT INTO movies (id, desired_qualities) VALUES
				('m-empty', NULL),
				('m-one', '["1080p"]'),
				('m-both', '["2160p","1080p"]');
			INSERT INTO series (id) VALUES ('s-1');
			INSERT INTO language_profiles (id, name, audio, subtitles)
			VALUES ('old-default', 'French', '{"preferOriginal":false,"languages":["fr"],"mode":"prefer"}', '[{"tag":"fr","variant":"regular","accessibility":"any"}]');
		`);

		migration_v154.apply(sqlite);

		expect(
			sqlite.prepare('SELECT desired_qualities FROM movies WHERE id = ?').get('m-empty')
		).toEqual({ desired_qualities: '["2160p","1080p"]' });
		expect(
			sqlite.prepare('SELECT desired_qualities FROM movies WHERE id = ?').get('m-one')
		).toEqual({ desired_qualities: '["2160p","1080p"]' });
		expect(
			sqlite.prepare('SELECT desired_qualities FROM movies WHERE id = ?').get('m-both')
		).toEqual({ desired_qualities: '["2160p","1080p"]' });

		const profile = sqlite
			.prepare('SELECT name, audio, subtitles FROM language_profiles WHERE id = ?')
			.get(ENGLISH_ORIGINAL_PROFILE_ID) as {
			name: string;
			audio: string;
			subtitles: string;
		};
		expect(profile.name).toBe('English + Original');
		expect(profile.audio).toContain('"en"');
		expect(profile.audio).toContain('"preferOriginal":true');
		expect(profile.subtitles).toContain('"en"');

		expect(
			sqlite
				.prepare('SELECT default_profile_id FROM language_settings WHERE id = ?')
				.get('singleton')
		).toEqual({ default_profile_id: ENGLISH_ORIGINAL_PROFILE_ID });
		expect(
			sqlite.prepare('SELECT language_profile_id FROM movies WHERE id = ?').get('m-empty')
		).toEqual({ language_profile_id: ENGLISH_ORIGINAL_PROFILE_ID });
		expect(
			sqlite.prepare('SELECT language_profile_id FROM series WHERE id = ?').get('s-1')
		).toEqual({ language_profile_id: ENGLISH_ORIGINAL_PROFILE_ID });
	});
});
