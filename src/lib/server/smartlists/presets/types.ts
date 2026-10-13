/**
 * External List Preset Types
 *
 * Type definitions for external list presets loaded from YAML files
 */

export interface PresetSetting {
	name: string;
	label: string;
	/** 'catalogs' and 'mdblist-list' are text values with a source-specific picker */
	type: 'number' | 'string' | 'password' | 'boolean' | 'select' | 'catalogs' | 'mdblist-list';
	required?: boolean;
	min?: number;
	max?: number;
	default?: number | string | boolean;
	options?: Array<{ value: string | number; label: string }>;
	helpText?: string;
}

export interface PresetDefinition {
	id: string;
	name: string;
	description: string;
	url?: string;
	config?: Record<string, unknown>;
	default?: boolean;
}

export interface PresetProvider {
	provider: string;
	name: string;
	description: string;
	icon: string;
	baseUrl: string;
	presets: PresetDefinition[];
	settings: PresetSetting[];
}

export interface ExternalListPreset {
	id: string;
	provider: string;
	providerName: string;
	name: string;
	description: string;
	icon: string;
	url?: string;
	config?: Record<string, unknown>;
	isDefault: boolean;
	settings: PresetSetting[];
}
