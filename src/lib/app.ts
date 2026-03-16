import { Cursor } from "./storage/reducer/cstradeup";

export type InventoryResponse = {
  success: boolean;
  total_inventory_count?: number;
  /** Populated after merging paginated responses */
  assets?: any[];
  /** Populated after merging paginated responses (deduped by classid+instanceid) */
  descriptions?: any[];
  /** 1 when more pages are available (stripped after merge) */
  more_items?: number;
  /** Cursor for the next page (stripped after merge) */
  last_assetid?: string;
  [k: string]: any;
};

export type SteamInventoryDataPayload = Record<string, InventoryResponse>;

type TypeMessage = 'POST_TO_API' | 'START_CRAWL' | 'INVENTORY_HISTORY' | 'START_INVENTORY_HISTORY' | 'STOP_OPERATION' | 'LOG_MESSAGE' | 'UPDATE_CURSOR' | 'UPDATE_APP_STATE' | 'ENSURE_MEMBER_SINCE' | 'NOTARIZE_CURSOR' | OffscreenMessage

type OffscreenMessage = 'ADD_APP_SYNCED_TRADEUP_ITEMS' | 'ADD_APP_SYNCED_STORAGE_UNIT_ITEMS' | 'ADD_NOTARIZED_TRADEUP_ITEMS'

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

export type StopOperationPayload = PayloadMessage & {
    type: 'STOP_OPERATION',
}

export function isStopOperationPayload(msg: unknown): msg is StopOperationPayload {
    if (!isTypePayloadMessage(msg)) return false
    return msg.type === 'STOP_OPERATION'
}

export type AppStateUpdate = PayloadMessage & {
    status: "idle" | "updating_inventory" | "updating_history" | "stopping" | "error",
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

export type EnsureMemberSincePayload = PayloadMessage & {
    type: 'ENSURE_MEMBER_SINCE',
}

export function isEnsureMemberSince(msg: unknown): msg is EnsureMemberSincePayload {
    if (!isTypePayloadMessage(msg)) return false
    return msg.type === 'ENSURE_MEMBER_SINCE'
}

export type NotarizeCursorPayload = PayloadMessage & {
    type: 'NOTARIZE_CURSOR',
    cursor: Cursor,
}

export function isNotarizeCursorPayload(msg: unknown): msg is NotarizeCursorPayload {
    if (!isTypePayloadMessage(msg)) return false
    return msg.type === 'NOTARIZE_CURSOR' && 'cursor' in msg
}

export type MessageType = ApiPostPayload | InventoryPayload | StartInventoryHistoryPayload | StopOperationPayload | LogMessage | UpdateCursor | AppStateUpdate | OffscreenPayloadMessage | EnsureMemberSincePayload | NotarizeCursorPayload

export const CSTRADEUPMessage = 'cstradeup_scripts'
export type CSTRADEUPMessageType = 'cstradeup_scripts'