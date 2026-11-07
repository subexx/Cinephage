import { describe, it, expect } from 'vitest';
import { isAdultRelease } from './AdultReleaseStage';

describe('isAdultRelease', () => {
	it('flags adult releases seen in the library', () => {
		expect(isAdultRelease('KinkyFamily.Lily.Rader.The.Innocent.Blondie.2025..2160p.')).toBe(true);
		expect(isAdultRelease('Asa.Akira-Brazzers-2012.08.02-Boning.My.Boss-1080p')).toBe(true);
		expect(
			isAdultRelease('NubileFilms.24.11.01.Sky.Wonderland.November.2024.XXX.2160p.MP4-WRB')
		).toBe(true);
		expect(
			isAdultRelease('2025.05.12.bang.vault.Eliza.Ibarra.is.a.professional.ass.eater.2160p')
		).toBe(true);
		expect(isAdultRelease('Some.Clip.2025.1080p', '6000')).toBe(true);
	});

	it('keeps normal films', () => {
		expect(isAdultRelease('Innocent.2025.Malayalam.1080p.WEB-DL')).toBe(false);
		expect(isAdultRelease('Cocktail.2012.1080p.BluRay')).toBe(false);
		expect(isAdultRelease('Pornichan.2024.1080p.WEB')).toBe(false);
		expect(isAdultRelease('Superman.Returns.2006.1080p', '2040')).toBe(false);
	});
});
