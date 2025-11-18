export async function hasPermission(permissions: chrome.runtime.ManifestPermission[], origins: string[]): Promise<boolean> {
    return await chrome.permissions.contains({
        permissions,
        origins,
    });
}