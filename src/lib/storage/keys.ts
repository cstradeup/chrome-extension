/**
 * Keys for use as the raw "key" in local/sync storage for a row
 */
export interface SerializedFilter {
    expression: string;
    colour: string;
    isGlobal: boolean;
}


export enum StorageKey {
    STEAM_ACCESS_TOKEN = 'steam_access_token',
    CSTRADEUP_ACCESS_TOKEN = 'cstradeup_access_token',
    HISTORY_UPDATE_CURSOR = 'history_update_cursor',
    LAST_UPDATE_INVENTORY_DATE = 'last_update_inventory_date',
    LAST_UPDATE_HISTORY_DATE = 'last_update_history_date',
    DEV_LOGS = 'dev_logs',
    APP_STATE = 'app_state',
    BILLING_INFO = 'billing_info',
}

export type DynamicStorageKey = string;

/**
 * Encapsulates a key/value pair, each key has a value associated
 */
export interface StorageRow<T> {
    key: StorageKey | DynamicStorageKey;
}

function newRow<T>(name: StorageKey): StorageRow<T> {
    return {key: name} as StorageRow<T>;
}

/**
 * Allows defining a "dynamic" row that has different keys at runtime, but share a similar
 * type.
 *
 * NOTE: This is generally **discouraged** and you should instead store under a static key with
 * an object of your desire. It exists to be compatible with historical poor decisions.
 *
 * @param suffix Storage key used as a suffix for the internal storage key
 */
function newDynamicRow<T>(suffix: StorageKey): (prefix: string) => StorageRow<T> {
    return function (prefix: string) {
        return {key: `${prefix}_${suffix}`} as StorageRow<T>;
    };
}
