/**
 * Pure eligibility helper for the stale-missing unmonitor lifecycle.
 *
 * An item is a candidate when it has been in the library at least `minAgeDays`
 * AND has accumulated at least `minFailed` consecutive failed content searches.
 * Callers still enforce monitored/missing (hasFile / episodeFileCount) gates.
 */

export interface StaleMissingCandidateInput {
	added: string | Date | null | undefined;
	attempts: number | null | undefined;
	minAgeDays: number;
	minFailed: number;
	now?: Date;
}

/**
 * Returns true when age and failed-search thresholds are both satisfied.
 */
export function isStaleMissingCandidate(input: StaleMissingCandidateInput): boolean {
	const { added, attempts, minAgeDays, minFailed, now = new Date() } = input;

	if (minAgeDays < 0 || minFailed < 0) return false;
	if ((attempts ?? 0) < minFailed) return false;
	if (added == null || added === '') return false;

	const addedDate = added instanceof Date ? added : new Date(added);
	if (Number.isNaN(addedDate.getTime())) return false;

	const ageMs = now.getTime() - addedDate.getTime();
	const minAgeMs = minAgeDays * 24 * 60 * 60 * 1000;
	return ageMs >= minAgeMs;
}
