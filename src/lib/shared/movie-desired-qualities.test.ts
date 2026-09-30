import { describe, expect, it } from 'vitest';
import {
	DEFAULT_MOVIE_DESIRED_QUALITIES,
	movieDesiredQualitiesOrDefault
} from './movie-desired-qualities.js';

describe('movieDesiredQualitiesOrDefault', () => {
	it('defaults omitted, null, and empty to 4K + 1080p', () => {
		expect(movieDesiredQualitiesOrDefault()).toEqual(DEFAULT_MOVIE_DESIRED_QUALITIES);
		expect(movieDesiredQualitiesOrDefault(null)).toEqual(['2160p', '1080p']);
		expect(movieDesiredQualitiesOrDefault([])).toEqual(['2160p', '1080p']);
	});

	it('defaults a single explicit tier so multi-quality still activates', () => {
		expect(movieDesiredQualitiesOrDefault(['1080p'])).toEqual(['2160p', '1080p']);
	});

	it('keeps two or more caller-selected tiers', () => {
		expect(movieDesiredQualitiesOrDefault(['1080p', '720p'])).toEqual(['1080p', '720p']);
		expect(movieDesiredQualitiesOrDefault(['2160p', '1080p', '720p'])).toEqual([
			'2160p',
			'1080p',
			'720p'
		]);
	});
});
