import { Cursor } from "./storage/reducer/cstradeup";

export type InventoryResponse = {
  success: boolean;
  total_inventory_count?: number;
  [k: string]: any;
};

export type SteamInventoryDataPayload = Record<string, InventoryResponse>;

type TypeMessage = 'POST_TO_API' | 'START_CRAWL' | 'INVENTORY_HISTORY' | 'START_INVENTORY_HISTORY' | 'LOG_MESSAGE' | 'UPDATE_CURSOR' | 'UPDATE_APP_STATE' | OffscreenMessage

type OffscreenMessage = 'ADD_APP_SYNCED_TRADEUP_ITEMS' | 'ADD_APP_SYNCED_STORAGE_UNIT_ITEMS'

export type PayloadMessage = {
    type: TypeMessage
}

export function isTypePayloadMessage(t: unknown): t is PayloadMessage {
    return t !== null && typeof t === 'object' && 'type' in t && typeof t.type === 'string'
}

export type ApiPostPayload = PayloadMessage & {
    steamId: string,
    results: Record<string, InventoryResponse>
}

export function isApiPostPayload(msg: unknown): msg is ApiPostPayload {
    if (!isTypePayloadMessage(msg)) return false
    return msg.type === 'POST_TO_API' && 'steamId' in msg && 'results' in msg
}

export type InventoryPayload = PayloadMessage & {
    steamId: string,
    payload: unknown,
}

export function isInventoryPayload(msg: unknown): msg is InventoryPayload {
    if (!isTypePayloadMessage(msg)) return false
    return msg.type === 'INVENTORY_HISTORY' && 'payload' in msg
}

export type StartInventoryHistoryPayload = PayloadMessage & {
    steamId: string | null,
    token: string | null,
    auth: string | null,
}

export function isStartInventoryHistoryPayload(msg: unknown): msg is StartInventoryHistoryPayload {
    if (!isTypePayloadMessage(msg)) return false
    return msg.type === 'START_INVENTORY_HISTORY'
}

export type LogMessage = PayloadMessage & {
    message: string,
    level?: 'info' | 'warn' | 'error',
}

export function isLogMessage(msg: unknown): msg is LogMessage {
    if (!isTypePayloadMessage(msg)) return false
    return msg.type === 'LOG_MESSAGE' && 'message' in msg
}

export type UpdateCursor = PayloadMessage & {
    cursor: Cursor,
}

export function isUpdateCursor(msg: unknown): msg is UpdateCursor {
    if (!isTypePayloadMessage(msg)) return false
    return msg.type === 'UPDATE_CURSOR' && 'cursor' in msg
}

export type AppStateUpdate = PayloadMessage & {
    status: "idle" | "updating_inventory" | "updating_history" | "error",
    statusMessage: string,
}

export function isAppStateUpdate(msg: unknown): msg is AppStateUpdate {
    if (!isTypePayloadMessage(msg)) return false
    return msg.type === 'UPDATE_APP_STATE' && 'status' in msg && 'statusMessage' in msg
}

export type OffscreenPayloadMessage = PayloadMessage & {
    amount: number,
}

export function isOffscreenPayloadMessage(msg: unknown): msg is OffscreenPayloadMessage {
    if (!isTypePayloadMessage(msg)) return false
    return (msg.type === 'ADD_APP_SYNCED_TRADEUP_ITEMS' || msg.type === 'ADD_APP_SYNCED_STORAGE_UNIT_ITEMS') && 'amount' in msg
}

export type MessageType = ApiPostPayload | InventoryPayload | StartInventoryHistoryPayload | LogMessage | UpdateCursor | AppStateUpdate | OffscreenPayloadMessage

export const CSTradeUpMessage = 'cstradeup_scripts'
export type CSTradeUpMessageType = 'cstradeup_scripts'