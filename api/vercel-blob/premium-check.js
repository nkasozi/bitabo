/**
 * Server-side premium user validation
 */

/**
 * Check if a user is a premium user based on their prefix
 * This is the server-side implementation that can't be circumvented by client-side code
 * 
 * @param {string} prefixKey The user's prefix key for cloud sync
 * @returns {boolean} Boolean indicating if the user is a premium user
 */
export function isPremiumUser(prefixKey) {
    if (!prefixKey) return false;

    //allow creation of test keys
    console.log(`checking if user is premium enabled: ${prefixKey}`)
    if(prefixKey.startsWith('testy')) return true;
    
    // For now, only "kasozi" and "esther" are premium users
    // In future this would connect to a real subscription database
    const premiumPrefixes = ['kasozi', 'esther'];
    return premiumPrefixes.includes(prefixKey.toLowerCase());
}

/**
 * Extract prefix from a blob pathname
 * Pathnames are formatted as `prefixKey_bookId.json`
 * 
 * @param {string} pathname The pathname to extract prefix from
 * @returns {string|null} The extracted prefix or null if not found
 */
export function extractPrefixFromPathname(pathname) {
    if (!pathname) return null;
    
    // Extract prefix part (before the underscore)
    const match = pathname.match(/^([^_]+)_/);
    return match ? match[1] : null;
}