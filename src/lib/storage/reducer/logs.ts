import {gStore} from '../../storage/store';
import {StorageKey} from '../../storage/keys';

export type LogEntry = {
    timestamp: number;
    message: string;
}

export interface DevLogs {
    logs: LogEntry[];
}

export async function getDevLogs(): Promise<DevLogs | null> {
    return gStore.getWithStorage<DevLogs>(chrome.storage.local, StorageKey.DEV_LOGS);
}

export async function saveDevLogs(logs: DevLogs): Promise<void> {
    return gStore.setWithStorage(chrome.storage.local, StorageKey.DEV_LOGS, logs);
}

export async function clearDevLogsFromStorage(): Promise<void> {
    return gStore.removeWithStorage(chrome.storage.local, StorageKey.DEV_LOGS);
}

export async function appendDevLog(message: string): Promise<void> {
    return getDevLogs().then((existingLogs) => {
        const logs: DevLogs = existingLogs || {logs: []};
        logs.logs.push({
            timestamp: Date.now(),
            message,
        });
        return saveDevLogs(logs);
    });
}


