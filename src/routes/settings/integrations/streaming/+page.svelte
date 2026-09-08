<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { HardDrive, Trash2, RefreshCw, Archive, Clock, Copy, Plug } from 'lucide-svelte';
	import { cleanupStreamingCache, updateStremioAddonSettings } from '$lib/api/settings.js';
	import { toasts } from '$lib/stores/toast.svelte';
	import { SettingsPage, SettingsSection } from '$lib/components/ui/settings';
	import { copyToClipboard } from '$lib/utils/clipboard';
	import { previewStreamFormat, type StremioFormatConfig } from '$lib/shared/stremio-format.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let cleaning = $state(false);
	let cleanupResult = $state<{ cleaned: number; freedMB: number } | null>(null);
	let savingFormat = $state(false);
	let addonName = $state(data.stremio.addonName);
	let formatName = $state(data.stremio.format.name);
	let formatDescription = $state(data.stremio.format.description);

	const formatPreview = $derived(
		previewStreamFormat({
			addonName,
			format: { name: formatName, description: formatDescription }
		})
	);

	async function handleCleanup() {
		cleaning = true;
		try {
			const result = await cleanupStreamingCache();

			cleanupResult = {
				cleaned: ((result as Record<string, unknown>).cleaned as number) ?? 0,
				freedMB: ((result as Record<string, unknown>).freedMB as number) ?? 0
			};
			toasts.success(m.settings_streaming_expiredCleaned());
		} catch (error) {
			toasts.error(error instanceof Error ? error.message : m.settings_streaming_failedToClean());
		} finally {
			cleaning = false;
		}
	}

	async function copyUrl(value: string) {
		const ok = await copyToClipboard(value);
		if (ok) {
			toasts.success(m.settings_streaming_stremioCopied());
		} else {
			toasts.error(m.settings_streaming_stremioCopyFailed());
		}
	}

	function applyPreset(preset: StremioFormatConfig) {
		formatName = preset.name;
		formatDescription = preset.description;
	}

	async function saveFormat() {
		savingFormat = true;
		try {
			await updateStremioAddonSettings({
				addonName,
				format: { name: formatName, description: formatDescription }
			});
			toasts.success(m.settings_streaming_stremioFormatSaved());
		} catch (error) {
			toasts.error(
				error instanceof Error ? error.message : m.settings_streaming_stremioFormatSaveFailed()
			);
		} finally {
			savingFormat = false;
		}
	}
</script>

<svelte:head>
	<title>{m.nav_streaming()}</title>
</svelte:head>

<SettingsPage
	title={m.settings_streaming_heading()}
	subtitle={m.settings_streaming_extractionCacheDescription()}
>
	<SettingsSection
		title={m.settings_streaming_stremioTitle()}
		description={m.settings_streaming_stremioDescription()}
	>
		{#if data.stremio.manifestUrl}
			<div class="space-y-3">
				<div>
					<div class="mb-1 text-sm font-medium">{m.settings_streaming_stremioManifestUrl()}</div>
					<div class="flex flex-col gap-2 sm:flex-row">
						<input
							class="input-bordered input w-full font-mono text-xs"
							readonly
							value={data.stremio.manifestUrl}
						/>
						<button
							class="btn gap-2 btn-outline btn-sm"
							onclick={() => copyUrl(data.stremio.manifestUrl!)}
							type="button"
						>
							<Copy class="h-4 w-4" />
							{m.settings_streaming_stremioCopy()}
						</button>
					</div>
				</div>
				{#if data.stremio.installUrl}
					<div>
						<div class="mb-1 text-sm font-medium">{m.settings_streaming_stremioInstallUrl()}</div>
						<div class="flex flex-col gap-2 sm:flex-row">
							<input
								class="input-bordered input w-full font-mono text-xs"
								readonly
								value={data.stremio.installUrl}
							/>
							<button
								class="btn gap-2 btn-outline btn-sm"
								onclick={() => copyUrl(data.stremio.installUrl!)}
								type="button"
							>
								<Copy class="h-4 w-4" />
								{m.settings_streaming_stremioCopy()}
							</button>
						</div>
					</div>
				{/if}
				<p class="text-sm text-base-content/70">{m.settings_streaming_stremioHint()}</p>
			</div>
		{:else}
			<div class="alert alert-warning">
				<Plug class="h-5 w-5" />
				<span>{m.settings_streaming_stremioMissingKey()}</span>
			</div>
		{/if}

		<div class="mt-6 grid gap-4 lg:grid-cols-2">
			<div class="space-y-4">
				<label class="form-control w-full">
					<span class="label-text mb-1">{m.settings_streaming_stremioAddonName()}</span>
					<input class="input-bordered input input-sm" bind:value={addonName} />
				</label>
				<div class="flex flex-wrap gap-2">
					{#each Object.entries(data.stremio.presets) as [id, preset]}
						<button
							class="btn btn-ghost btn-xs"
							onclick={() => applyPreset(preset)}
							type="button"
						>
							{data.stremio.presetLabels[id] ?? id}
						</button>
					{/each}
				</div>
				<label class="form-control w-full">
					<span class="label-text mb-1">{m.settings_streaming_stremioNameTemplate()}</span>
					<textarea class="textarea-bordered textarea font-mono text-sm" rows="3" bind:value={formatName}
					></textarea>
				</label>
				<label class="form-control w-full">
					<span class="label-text mb-1">{m.settings_streaming_stremioDescriptionTemplate()}</span>
					<textarea
						class="textarea-bordered textarea font-mono text-sm"
						rows="6"
						bind:value={formatDescription}
					></textarea>
				</label>
				<p class="text-xs text-base-content/60">{m.settings_streaming_stremioTokens()}</p>
				<button
					class="btn btn-primary btn-sm"
					onclick={saveFormat}
					disabled={savingFormat}
					type="button"
				>
					{#if savingFormat}
						<RefreshCw class="h-4 w-4 animate-spin" />
					{/if}
					{m.settings_streaming_stremioSaveFormat()}
				</button>
			</div>
			<div class="rounded-xl bg-base-100 p-4">
				<p class="mb-3 text-sm text-base-content/60">{m.settings_streaming_stremioPreview()}</p>
				<p class="whitespace-pre-wrap font-medium text-primary">{formatPreview.name}</p>
				<pre class="mt-2 whitespace-pre-wrap font-sans text-sm">{formatPreview.description}</pre>
			</div>
		</div>
	</SettingsSection>

	<!-- Extraction Cache Section -->
	<SettingsSection title={m.settings_streaming_extractionCache()}>
		<!-- Cache Stats -->
		<div class="stats w-full stats-vertical bg-base-100 shadow lg:stats-horizontal">
			<div class="stat">
				<div class="stat-figure text-primary">
					<Archive class="h-6 w-6" />
				</div>
				<div class="stat-title">{m.settings_streaming_cachedFiles()}</div>
				<div class="stat-value text-primary">{data.cacheStats.fileCount}</div>
			</div>

			<div class="stat">
				<div class="stat-figure text-secondary">
					<HardDrive class="h-6 w-6" />
				</div>
				<div class="stat-title">{m.settings_streaming_cacheSize()}</div>
				<div class="stat-value text-secondary">
					{data.cacheStats.totalSizeMB >= 1024
						? `${(data.cacheStats.totalSizeMB / 1024).toFixed(1)} GB`
						: `${data.cacheStats.totalSizeMB} MB`}
				</div>
			</div>

			<div class="stat">
				<div class="stat-figure text-warning">
					<Clock class="h-6 w-6" />
				</div>
				<div class="stat-title">{m.settings_streaming_expired()}</div>
				<div class="stat-value text-warning">{data.cacheStats.expiredCount}</div>
				<div class="stat-desc">{m.settings_streaming_pendingCleanup()}</div>
			</div>
		</div>

		<!-- Cleanup Action -->
		<div>
			{#if cleanupResult}
				<div class="mb-4 alert alert-success">
					<span>
						{m.settings_streaming_cleanedUpResult({
							count: String(cleanupResult.cleaned),
							size:
								cleanupResult.freedMB >= 1024
									? `${(cleanupResult.freedMB / 1024).toFixed(1)} GB`
									: `${cleanupResult.freedMB} MB`
						})}
					</span>
				</div>
			{/if}

			<button
				class="btn gap-2 btn-outline btn-sm btn-warning"
				onclick={handleCleanup}
				disabled={cleaning}
			>
				{#if cleaning}
					<RefreshCw class="h-4 w-4 animate-spin" />
					{m.settings_streaming_cleaning()}
				{:else}
					<Trash2 class="h-4 w-4" />
					{m.settings_streaming_cleanExpiredFiles()}
				{/if}
			</button>
		</div>
	</SettingsSection>

	<!-- Cache Settings -->
	<SettingsSection title={m.settings_streaming_cacheSettings()}>
		<div class="form-control w-full max-w-xs">
			<label class="label" for="retention">
				<span class="label-text">{m.settings_streaming_retentionPeriod()}</span>
			</label>
			<select id="retention" class="select-bordered select select-sm" disabled>
				<option value="24">{m.settings_streaming_hours24()}</option>
				<option value="48" selected>{m.settings_streaming_hours48Default()}</option>
				<option value="72">{m.settings_streaming_hours72()}</option>
				<option value="168">{m.settings_streaming_week1()}</option>
			</select>
			<div class="label">
				<span class="label-text-alt text-base-content/50">
					{m.settings_streaming_retentionHint()}
				</span>
			</div>
		</div>

		<div class="alert alert-info">
			<span>{m.settings_streaming_cacheDefaultsNotice()}</span>
		</div>
	</SettingsSection>

	<!-- How It Works -->
	<SettingsSection title={m.settings_streaming_howItWorks()}>
		<div class="prose-sm prose max-w-none">
			<ol class="space-y-2">
				<li>
					<strong>{m.settings_streaming_stepDetection()}:</strong>
					{m.settings_streaming_stepDetectionDesc()}
				</li>
				<li>
					<strong>{m.settings_streaming_stepDownload()}:</strong>
					{m.settings_streaming_stepDownloadDesc()}
				</li>
				<li>
					<strong>{m.settings_streaming_stepExtraction()}:</strong>
					{m.settings_streaming_stepExtractionDesc()}
				</li>
				<li>
					<strong>{m.settings_streaming_stepStreaming()}:</strong>
					{m.settings_streaming_stepStreamingDesc()}
				</li>
				<li>
					<strong>{m.settings_streaming_stepCleanup()}:</strong>
					{m.settings_streaming_stepCleanupDesc()}
				</li>
			</ol>
		</div>
	</SettingsSection>
</SettingsPage>
