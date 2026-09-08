import { getLanguageName } from './languages.js';
import { renderTemplate, type TemplateContext } from './stremio-template.js';

export interface StremioFormatConfig {
	name: string;
	description: string;
}

export interface StremioAddonDisplaySettings {
	addonName: string;
	format: StremioFormatConfig;
}

export const DEFAULT_STREMIO_FORMAT: StremioFormatConfig = {
	name: '{addon.name} {stream.resolution} | {server.type}',
	description:
		'{stream.filename}\n{stream.resolution} • {stream.video} • {stream.hdr} • {stream.audio} • {stream.size::bytes} • {server.name}'
};

export const STREMIO_FORMAT_PRESETS: Record<string, StremioFormatConfig> = {
	aiomedia: DEFAULT_STREMIO_FORMAT,
	compact: {
		name: '{server.name} {stream.resolution}',
		description: '{stream.filename}\n{stream.video} • {stream.audio} • {stream.size::bytes}'
	},
	detailed: {
		name: '{addon.name} | {server.name}',
		description:
			'{stream.filename}\n{stream.resolution} {stream.hdr}\n{stream.video} • {stream.audio}\n{stream.container} • {stream.size::bytes}'
	},
	emoji: {
		name: '{stream.resolution::=2160p["🔥 4K UHD"||""]}{stream.resolution::=1440p["🚀 1440p"||""]}{stream.resolution::=1080p["🚀 Full HD"||""]}{stream.resolution::=720p["💿 HD"||""]}{stream.resolution::=576p["💩 Low Quality"||""]}{stream.resolution::=480p["💩 Low Quality"||""]}{stream.resolution::=Unknown["💩 Unknown"||""]}{stream.resolution::exists[""||"💩 Unknown"]} - {server.name}',
		description:
			'🎬 {stream.edition::exists["{stream.edition} "||""]}{stream.filename}\n{stream.audioTags::exists["🎧 {stream.audioTags::join(\' | \')}"||""]} {stream.audioChannels::exists["🔊 {stream.audioChannels::join(\' \')}"||""]} {stream.size::>0["📦 {stream.size::bytes}"||""]}\n{stream.languages::exists["🗣️ {stream.languages::join(\' • \')}"||""]}'
	},
	quality: {
		name: '{stream.resolution::=2160p["🔥 4K"||""]}{stream.resolution::=1440p["🚀 1440p"||""]}{stream.resolution::=1080p["🚀 1080p"||""]}{stream.resolution::=720p["💿 720p"||""]}{stream.resolution::exists[""||"SD"]} · {addon.name}',
		description:
			'{stream.filename}\n{stream.video} • {stream.hdr} • {stream.audio} • {stream.size::bytes} • {server.name}'
	}
};

export const STREMIO_FORMAT_PRESET_LABELS: Record<string, string> = {
	aiomedia: 'AIOMedia',
	compact: 'Compact',
	detailed: 'Detailed',
	emoji: 'Emoji',
	quality: 'Quality badges'
};

export const DEFAULT_STREMIO_ADDON_SETTINGS: StremioAddonDisplaySettings = {
	addonName: 'Cinephage',
	format: DEFAULT_STREMIO_FORMAT
};

export interface StreamFormatInput {
	filename: string;
	resolution?: string | null;
	video?: string | null;
	hdr?: string | null;
	audio?: string | null;
	channels?: string | null;
	container?: string | null;
	size?: number | null;
	bitrate?: number | null;
	remux?: boolean;
	edition?: string | null;
	languages?: string[] | null;
}

const EDITIONS: Array<[RegExp, string]> = [
	[/director'?s\s*cut/i, "Director's Cut"],
	[/\bextended\b/i, 'Extended'],
	[/\bunrated\b/i, 'Unrated'],
	[/\buncut\b/i, 'Uncut'],
	[/\bimax\b/i, 'IMAX'],
	[/\btheatrical\b/i, 'Theatrical'],
	[/\bremastered\b/i, 'Remastered'],
	[/\bcriterion\b/i, 'Criterion'],
	[/\blimited\b/i, 'Limited']
];

const VIDEO_CODEC: Record<string, string> = {
	H264: 'H.264',
	AVC: 'H.264',
	'H.264': 'H.264',
	X264: 'H.264',
	H265: 'HEVC',
	HEVC: 'HEVC',
	'H.265': 'HEVC',
	X265: 'HEVC',
	VP9: 'VP9',
	AV1: 'AV1',
	MPEG2VIDEO: 'MPEG-2',
	VC1: 'VC-1'
};

const AUDIO_CODEC: Record<string, string> = {
	AAC: 'AAC',
	AC3: 'DD',
	'AC-3': 'DD',
	EAC3: 'DD+',
	'E-AC-3': 'DD+',
	DTS: 'DTS',
	DTSHD: 'DTS-HD',
	TRUEHD: 'TrueHD',
	FLAC: 'FLAC',
	OPUS: 'Opus',
	MP3: 'MP3',
	PCM: 'PCM',
	DCA: 'DTS'
};

export function mapVideoCodec(codec?: string | null): string {
	if (!codec) return '';
	const key = codec.toUpperCase().replace(/[\s._-]/g, '');
	return VIDEO_CODEC[codec.toUpperCase()] || VIDEO_CODEC[key] || codec.toUpperCase();
}

export function mapAudioCodec(codec?: string | null, channels?: number | null): string {
	if (!codec) return '';
	const key = codec.toUpperCase().replace(/[\s._-]/g, '');
	const display = AUDIO_CODEC[codec.toUpperCase()] || AUDIO_CODEC[key] || codec.toUpperCase();
	let layout = '';
	if (channels === 1) layout = 'Mono';
	else if (channels === 2) layout = '2.0';
	else if (channels === 6) layout = '5.1';
	else if (channels === 8) layout = '7.1';
	else if (channels) layout = `${channels}ch`;
	return layout ? `${display} ${layout}` : display;
}

export function aioResolution(label?: string | null): string {
	if (!label) return 'Unknown';
	if (label === '4K' || label === '4K DCI' || label === '2160p') return '2160p';
	if (label === 'SD') return '480p';
	return label;
}

export function parseEdition(filename: string, explicit?: string | null): string {
	if (explicit?.trim()) return explicit.trim();
	for (const [re, label] of EDITIONS) {
		if (re.test(filename)) return label;
	}
	return '';
}

export function displayLanguages(codes?: string[] | null): string[] {
	if (!codes?.length) return [];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const code of codes) {
		const name = getLanguageName(code);
		if (!name || seen.has(name)) continue;
		seen.add(name);
		out.push(name);
	}
	return out;
}

function splitAudio(audio?: string, channels?: string): { tags: string[]; layouts: string[] } {
	const tags: string[] = [];
	const layouts: string[] = [];
	const raw = `${audio || ''} ${channels || ''}`.trim();
	if (!raw) return { tags, layouts };
	if (/\batmos\b/i.test(raw)) tags.push('Atmos');
	const codec = raw
		.replace(/\batmos\b/gi, '')
		.replace(/\b(\d+\.\d+|mono|\d+ch)\b/gi, '')
		.replace(/\s+/g, ' ')
		.trim();
	if (codec) tags.unshift(codec);
	const layout = (channels || raw.match(/\b(\d+\.\d+|mono|\d+ch)\b/i)?.[1] || '').trim();
	if (layout) layouts.push(layout);
	return {
		tags: [...new Set(tags.filter(Boolean))],
		layouts: [...new Set(layouts.filter(Boolean))]
	};
}

function formatBitrate(bps?: number | null): string {
	if (!bps || bps <= 0) return '';
	return `${(bps / 1_000_000).toFixed(1)} Mbps`;
}

export function streamFormatContext(
	stream: StreamFormatInput,
	addonName: string
): TemplateContext {
	const { tags, layouts } = splitAudio(stream.audio ?? '', stream.channels ?? '');
	const filename = stream.filename || '';
	return {
		addonName,
		addon: { name: addonName },
		server: {
			name: addonName,
			type: 'Cinephage',
			id: 'cinephage'
		},
		stream: {
			filename,
			resolution: aioResolution(stream.resolution),
			video: stream.video || '',
			hdr: stream.hdr && stream.hdr.toUpperCase() !== 'SDR' ? stream.hdr : '',
			audio: stream.audio || '',
			audioTags: tags,
			audioChannels: layouts,
			channels: stream.channels || layouts[0] || '',
			container: stream.container || '',
			size: stream.size && stream.size > 1024 ? stream.size : 0,
			bitrate: formatBitrate(stream.bitrate),
			remux: stream.remux ? 'REMUX' : '',
			transcode: '',
			edition: parseEdition(filename, stream.edition),
			languages: displayLanguages(stream.languages)
		}
	};
}

export function formatStreamLabels(
	stream: StreamFormatInput,
	settings: StremioAddonDisplaySettings
): { name: string; description: string } {
	const ctx = streamFormatContext(stream, settings.addonName);
	return {
		name: renderTemplate(settings.format.name, ctx) || settings.addonName,
		description: renderTemplate(settings.format.description, ctx) || stream.filename
	};
}

export const STREMIO_FORMAT_PREVIEW_SAMPLE: StreamFormatInput = {
	filename: 'Dune.Part.Two.2024.EXTENDED.2160p.UHD.BluRay.REMUX.HDR10.DV.TrueHD.Atmos.7.1.ENG.mkv',
	resolution: '2160p',
	video: 'HEVC',
	hdr: 'DV',
	audio: 'TrueHD Atmos 7.1',
	channels: '7.1',
	container: 'MKV',
	size: Math.round(42.1 * 1024 ** 3),
	bitrate: 82_000_000,
	remux: true,
	edition: 'Extended',
	languages: ['en']
};

export function previewStreamFormat(settings: StremioAddonDisplaySettings): {
	name: string;
	description: string;
} {
	return formatStreamLabels(STREMIO_FORMAT_PREVIEW_SAMPLE, settings);
}
