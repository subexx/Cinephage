import { describe, it, expect } from 'vitest';
import { isStaleMissingCandidate } from './staleMissingEligibility.js';

describe('isStaleMissingCandidate', () => {
	const now = new Date('2026-09-30T12:00:00.000Z');

	it('returns true when age and failed-search thresholds are met', () => {
		expect(
			isStaleMissingCandidate({
				added: '2025-09-30T12:00:00.000Z',
				attempts: 5,
				minAgeDays: 365,
				minFailed: 5,
				now
			})
		).toBe(true);
	});

	it('returns false when age is below threshold', () => {
		expect(
			isStaleMissingCandidate({
				added: '2026-03-01T12:00:00.000Z',
				attempts: 10,
				minAgeDays: 365,
				minFailed: 5,
				now
			})
		).toBe(false);
	});

	it('returns false when failed searches are below threshold', () => {
		expect(
			isStaleMissingCandidate({
				added: '2024-01-01T00:00:00.000Z',
				attempts: 4,
				minAgeDays: 365,
				minFailed: 5,
				now
			})
		).toBe(false);
	});

	it('returns false for missing or invalid added timestamps', () => {
		expect(
			isStaleMissingCandidate({
				added: null,
				attempts: 5,
				minAgeDays: 365,
				minFailed: 5,
				now
			})
		).toBe(false);
		expect(
			isStaleMissingCandidate({
				added: 'not-a-date',
				attempts: 5,
				minAgeDays: 365,
				minFailed: 5,
				now
			})
		).toBe(false);
	});

	it('treats null attempts as zero', () => {
		expect(
			isStaleMissingCandidate({
				added: '2024-01-01T00:00:00.000Z',
				attempts: null,
				minAgeDays: 365,
				minFailed: 5,
				now
			})
		).toBe(false);
	});
});
