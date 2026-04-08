import { gStore } from '../../storage/store';
import { StorageKey } from '../../storage/keys';

export interface BillingInfo {
    first_name: string;
    last_name: string;
    billing_address: string;
    billing_address_two: string;
    billing_country: string;
    billing_city: string;
    billing_state: string;
    billing_postal_code: string;
    save_my_address: number;
}

export async function getBillingInfo(): Promise<BillingInfo | null> {
    return gStore.getWithStorage<BillingInfo>(chrome.storage.local, StorageKey.BILLING_INFO);
}

export async function saveBillingInfo(info: BillingInfo): Promise<void> {
    return gStore.setWithStorage<BillingInfo>(chrome.storage.local, StorageKey.BILLING_INFO, info);
}
