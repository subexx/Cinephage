/**
 * AIOStreams-style stream name/description templates.
 * Same engine as AIOMedia / SuFlixMedia.
 */

export type TemplateValue = string | number | boolean | string[] | undefined;
export type TemplateContext = Record<string, unknown>;

function formatTemplateBytes(bytes: number): string {
	if (!bytes || bytes <= 0) return '';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let size = bytes;
	let i = 0;
	while (size >= 1024 && i < units.length - 1) {
		size /= 1024;
		i += 1;
	}
	const decimals = i >= 3 ? 1 : 0;
	return `${size.toFixed(decimals)} ${units[i]}`;
}

function findClose(source: string, openIdx: number, open: string, close: string): number {
	let depth = 0;
	let quote: string | null = null;
	for (let i = openIdx; i < source.length; i++) {
		const ch = source[i];
		if (quote) {
			if (ch === '\\') {
				i += 1;
				continue;
			}
			if (ch === quote) quote = null;
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			continue;
		}
		if (ch === open) depth += 1;
		else if (ch === close) {
			depth -= 1;
			if (depth === 0) return i;
		}
	}
	return -1;
}

function unquote(value: string): string {
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function splitTopLevel(source: string, sep: string): string[] {
	const parts: string[] = [];
	let start = 0;
	let quote: string | null = null;
	let brace = 0;
	let bracket = 0;
	for (let i = 0; i < source.length; i++) {
		const ch = source[i];
		if (quote) {
			if (ch === '\\') {
				i += 1;
				continue;
			}
			if (ch === quote) quote = null;
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			continue;
		}
		if (ch === '{') brace += 1;
		else if (ch === '}') brace -= 1;
		else if (ch === '[') bracket += 1;
		else if (ch === ']') bracket -= 1;
		else if (brace === 0 && bracket === 0 && source.startsWith(sep, i)) {
			parts.push(source.slice(start, i));
			i += sep.length - 1;
			start = i + 1;
		}
	}
	parts.push(source.slice(start));
	return parts;
}

function lookup(ctx: TemplateContext, path: string): TemplateValue {
	if (path === 'addonName') path = 'addon.name';
	const parts = path.split('.');
	let current: unknown = ctx;
	for (const part of parts) {
		if (current == null || typeof current !== 'object') return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	if (Array.isArray(current)) return current.map(String);
	if (typeof current === 'string' || typeof current === 'number' || typeof current === 'boolean') {
		return current;
	}
	return undefined;
}

function exists(value: TemplateValue): boolean {
	if (value == null || value === false) return false;
	if (typeof value === 'number') return Number.isFinite(value);
	if (typeof value === 'string') return value.trim().length > 0;
	if (Array.isArray(value)) return value.length > 0;
	return true;
}

function asNumber(value: TemplateValue): number {
	if (typeof value === 'number') return value;
	if (typeof value === 'string') return Number(value.replace(/[^\d.-]/g, '')) || 0;
	if (Array.isArray(value)) return value.length;
	return 0;
}

function asString(value: TemplateValue): string {
	if (value == null || value === false) return '';
	if (Array.isArray(value)) return value.filter(Boolean).join(' • ');
	return String(value);
}

function compare(left: TemplateValue, op: string, right: string): boolean {
	if (op === '=' || op === '==') {
		const a = asString(left).toLowerCase();
		const b = right.toLowerCase();
		if (a === b) return true;
		if ((a === '4k' || a === '2160p') && (b === '4k' || b === '2160p')) return true;
		return false;
	}
	if (op === '!=') return !compare(left, '=', right);
	const lv = asNumber(left);
	const rv = Number(right);
	if (op === '>') return lv > rv;
	if (op === '>=') return lv >= rv;
	if (op === '<') return lv < rv;
	if (op === '<=') return lv <= rv;
	return false;
}

function applyModifier(value: TemplateValue, modifier: string, ctx: TemplateContext): string {
	const join = modifier.match(/^join\((['"])(.*)\1\)$/i);
	if (join) {
		const list = Array.isArray(value) ? value : asString(value) ? [asString(value)] : [];
		return list.filter(Boolean).join(join[2]);
	}
	if (modifier === 'bytes') return formatTemplateBytes(asNumber(value));
	if (modifier === 'upper') return asString(value).toUpperCase();
	if (modifier === 'lower') return asString(value).toLowerCase();
	if (modifier === 'title') {
		return asString(value).replace(
			/\w\S*/g,
			(word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
		);
	}
	return renderTemplate(asString(value), ctx);
}

function evalExpr(inner: string, ctx: TemplateContext): string {
	const trimmed = inner.trim();
	const bracket = trimmed.indexOf('[');
	const modAt = trimmed.indexOf('::');
	let path = trimmed;
	let modifier = '';
	let whenTrue = '';
	let whenFalse = '';
	let hasCond = false;

	if (bracket >= 0 && (modAt === -1 || bracket > modAt)) {
		const close = findClose(trimmed, bracket, '[', ']');
		if (close > bracket) {
			const body = trimmed.slice(bracket + 1, close);
			const parts = splitTopLevel(body, '||');
			whenTrue = unquote(parts[0] || '');
			whenFalse = unquote(parts[1] || '');
			hasCond = true;
			path = trimmed.slice(0, bracket);
		}
	}

	const split = path.indexOf('::');
	if (split >= 0) {
		modifier = path.slice(split + 2).trim();
		path = path.slice(0, split).trim();
	} else {
		path = path.trim();
	}

	const value = lookup(ctx, path);
	if (hasCond) {
		let ok = exists(value);
		if (modifier === 'exists') ok = exists(value);
		else if (/^(==?|!=|>=|<=|>|<)/.test(modifier)) {
			const op = modifier.match(/^(==?|!=|>=|<=|>|<)/)?.[1] || '=';
			const arg = modifier.slice(op.length).trim();
			ok = compare(value, op, arg);
		} else if (modifier) ok = applyModifier(value, modifier, ctx).length > 0;
		return renderTemplate(ok ? whenTrue : whenFalse, ctx, false);
	}
	if (!modifier) {
		if (path === 'stream.size' && typeof value === 'number') return formatTemplateBytes(value);
		return asString(value);
	}
	if (modifier === 'exists') return exists(value) ? asString(value) : '';
	if (/^(==?|!=|>=|<=|>|<)/.test(modifier)) {
		const op = modifier.match(/^(==?|!=|>=|<=|>|<)/)?.[1] || '=';
		const arg = modifier.slice(op.length).trim();
		return compare(value, op, arg) ? asString(value) : '';
	}
	return applyModifier(value, modifier, ctx);
}

export function renderTemplate(template: string, ctx: TemplateContext, tidy = true): string {
	let out = '';
	for (let i = 0; i < template.length; i++) {
		if (template[i] !== '{') {
			out += template[i];
			continue;
		}
		const end = findClose(template, i, '{', '}');
		if (end < 0) {
			out += template[i];
			continue;
		}
		out += evalExpr(template.slice(i + 1, end), ctx);
		i = end;
	}
	if (!tidy) return out;
	return out
		.split('\n')
		.map((line) =>
			line
				.replace(/\s*•\s*(?:•\s*)+/g, ' • ')
				.replace(/^\s*•\s*|\s*•\s*$/g, '')
				.replace(/\s{2,}/g, ' ')
				.replace(/\s+\|/g, ' |')
				.replace(/\|\s+/g, '| ')
				.trim()
		)
		.filter((line, i, arr) => line.length > 0 || (i > 0 && i < arr.length - 1))
		.join('\n')
		.trim();
}
