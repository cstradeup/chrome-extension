/**
 * Cached DOM element references — queried once at boot, reused everywhere.
 * Every element is nullable to guard against missing markup.
 */

function el<T extends HTMLElement = HTMLElement>(id: string): T | null {
    return document.getElementById(id) as T | null;
}

export function queryElements() {
    return {
        // Stats cards
        totalItems:     el('total_items'),
        tradeupItems:   el('tradeup_items'),
        storageItems:   el('storeage_unit_items'),

        // Action buttons
        startBtn:               el<HTMLButtonElement>('start'),
        startInventoryHistory:  el<HTMLButtonElement>('start_inventory_history'),

        // Timestamps
        inventoryLastUpdated:       el('inventory_last_updated'),
        historyLastUpdated:         el('inventory_history_last_updated'),
        historyUpdatedUntil:        el('inventory_history_updated_until'),

        // Status panel
        statusPanel:    el('status_panel'),
        statusIdle:     el('status_idle'),
        statusActive:   el('status_active'),
        statusError:    el('status_error'),
        statusLabel:    el('status_label'),
        statusDetail:   el('status_detail'),
        statusElapsed:  el('status_elapsed'),
        statusErrorMsg: el('status_error_message'),
        statusWarning:  el('status_warning'),
        statusWarningMsg: el('status_warning_message'),
        statusItems:    el('status_items'),
        statusTradeups: el('status_tradeups'),
        statusStorage:  el('status_storage'),
        stopOperation:  el<HTMLButtonElement>('stop_operation'),

        // History progress timeline
        historyProgressContainer: el('history_progress_container'),
        progressPercentage:       el('progress_percentage'),
        progressCursorDate:       el('progress_cursor_date'),
        progressBarFill:          el('progress_bar_fill'),
        progressBarShimmer:       el('progress_bar_shimmer'),
        progressNowDate:          el('progress_now_date'),
        progressAccountDate:      el('progress_account_date'),

        // History progress labels (dynamic during catching-up)
        progressRightLabel:       el('progress_right_label'),

        // History sync state badge
        historySyncState:         el('history_sync_state'),

        // Contextual CTA zones
        syncCtaIntro:             el('sync_cta_intro'),
        syncCtaComplete:          el('sync_cta_complete'),
        syncPartialHint:          el('sync_partial_hint'),
        syncMetadata:             el('sync_metadata'),
        linkPortfolio:            el<HTMLAnchorElement>('link_portfolio'),
        linkTradeupArchive:       el<HTMLAnchorElement>('link_tradeup_archive'),

        // Onboarding screens
        onboardingSteam:      el('onboarding_steam'),
        onboardingCstradeup:  el('onboarding_cstradeup'),
        recheckSteam:         el<HTMLButtonElement>('recheck_steam'),
        recheckCstradeup:     el<HTMLButtonElement>('recheck_cstradeup'),

        // Main content wrapper
        mainContent:          el('main_content'),

        // Devtools
        devtools:               el('devtools'),
        openOptions:            el('open_options'),
        closeDevtools:          el('close_devtools'),
        logs:                   el<HTMLPreElement>('logs'),
        clearLogs:              el('clear_logs'),
        debug:                  el('debug'),
        nukeStorage:            el('nuke_storage'),
    } as const;
}

export type Elements = ReturnType<typeof queryElements>;
