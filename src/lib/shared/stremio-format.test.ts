import { describe, expect, it } from 'vitest';
import {
	DEFAULT_STREMIO_ADDON_SETTINGS,
	STREMIO_FORMAT_PRESETS,
	formatStreamLabels,
	previewStreamFormat
} from './stremio-format.js';

describe('stremio format templates', () => {
	it('matches the AIOMedia default name and description', () => {
		const preview = previewStreamFormat(DEFAULT_STREMIO_ADDON_SETTINGS);
		expect(preview.name).toBe('Cinephage 2160p | Cinephage');
		expect(preview.description).toContain('Dune.Part.Two.2024.EXTENDED.2160p');
		expect(preview.description).toContain('HEVC');
		expect(preview.description).toContain('DV');
		expect(preview.description).toContain('TrueHD Atmos 7.1');
	});

	it('applies the compact preset', () => {
		const labels = formatStreamLabels(
			{
				filename: 'Movie.mkv',
				resolution: '1080p',
				video: 'H.264',
				audio: 'AAC 2.0',
				size: 8 * 1024 ** 3
			},
			{ addonName: 'Home', format: STREMIO_FORMAT_PRESETS.compact }
		);
		expect(labels.name).toBe('Home 1080p');
		expect(labels.description).toContain('Movie.mkv');
		expect(labels.description).toContain('8.0 GB');
	});
});
