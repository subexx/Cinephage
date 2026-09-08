import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migration_v138 } from './138-movie-qualities-and-language-policy.js';
import { ENGLISH_ORIGINAL_PROFILE_ID } from '$lib/shared/preferred-language.js';

describe('migration v138', () => {
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
				languages text NOT NULL,
				cutoff_index integer DEFAULT 0,
				upgrades_allowed integer DEFAULT 1,
				minimum_score integer DEFAULT 60,
				is_default integer DEFAULT 0,
				created_at text,
				updated_at text
			);
			CREATE TABLE subtitle_settings (
				key text PRIMARY KEY,
				value text NOT NULL
			);
			INSERT INTO movies (id, desired_qualities) VALUES
				('m-empty', NULL),
				('m-one', '["1080p"]'),
				('m-both', '["2160p","1080p"]');
			INSERT INTO series (id) VALUES ('s-1');
			INSERT INTO language_profiles (id, name, languages, is_default)
			VALUES ('old-default', 'French', '[{"code":"fr"}]', 1);
		`);

		migration_v138.apply(sqlite);

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
			.prepare('SELECT name, is_default, languages FROM language_profiles WHERE id = ?')
			.get(ENGLISH_ORIGINAL_PROFILE_ID) as {
			name: string;
			is_default: number;
			languages: string;
		};
		expect(profile.name).toBe('English + Original');
		expect(profile.is_default).toBe(1);
		expect(profile.languages).toContain('original');

		expect(
			sqlite.prepare('SELECT is_default FROM language_profiles WHERE id = ?').get('old-default')
		).toEqual({ is_default: 0 });
		expect(
			sqlite.prepare('SELECT language_profile_id FROM movies WHERE id = ?').get('m-empty')
		).toEqual({ language_profile_id: ENGLISH_ORIGINAL_PROFILE_ID });
		expect(
			sqlite.prepare('SELECT language_profile_id FROM series WHERE id = ?').get('s-1')
		).toEqual({ language_profile_id: ENGLISH_ORIGINAL_PROFILE_ID });
		expect(
			sqlite
				.prepare('SELECT value FROM subtitle_settings WHERE key = ?')
				.get('default_language_profile_id')
		).toEqual({ value: ENGLISH_ORIGINAL_PROFILE_ID });
	});
});
