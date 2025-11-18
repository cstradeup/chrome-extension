export type InventoryResponse = {
  success: boolean;
  total_inventory_count?: number;
  [k: string]: any;
};

export type SteamInventoryDataPayload = {
    steamId: string,
    data: Record<string, InventoryResponse>
}
type TypeMessage = 'POST_TO_API' | 'START_CRAWL' | 'INVENTORY_HISTORY' | 'START_INVENTORY_HISTORY'

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

export type StartInventoryHistoryPayload = PayloadMessage

export function isStartInventoryHistoryPayload(msg: unknown): msg is StartInventoryHistoryPayload {
    if (!isTypePayloadMessage(msg)) return false
    return msg.type === 'START_INVENTORY_HISTORY'
}

export type MessageType = ApiPostPayload | InventoryPayload | StartInventoryHistoryPayload

export const CSTradeUpMessage = 'cstradeup_scripts'
export type CSTradeUpMessageType = 'cstradeup_scripts'