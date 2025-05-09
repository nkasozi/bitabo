
/**
 * Get the premium status message for display to non-premium users
 * @returns {string} HTML message with premium subscription information
 */
export function getPremiumMessage(): string {
    // Check for dark mode
    const isDarkMode = typeof document !== 'undefined' && 
                      (document.documentElement.classList.contains('dark') || 
                      (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches));
    
    const bgColor = isDarkMode ? '#1f2937' : 'white';
    const textColor = isDarkMode ? '#e5e7eb' : '#333';
    const accentColor = '#4285f4';
    const mutedColor = isDarkMode ? '#9ca3af' : '#666';
    const borderColor = isDarkMode ? '#374151' : '#eaeaea';
    
    return `
    <div class="premium-message" style="text-align: center; padding: 24px; color: ${textColor}; background-color: ${bgColor}; border-radius: 8px 8px 0 0;">
        <div style="margin-bottom: 20px;">
            <svg width="80" height="80" viewBox="0 0 24 24" fill="none" style="margin: 0 auto; display: block;">
                <circle cx="12" cy="12" r="10" stroke="${accentColor}" stroke-width="2" />
                <path d="M12 7v6l3 3" stroke="${accentColor}" stroke-width="2" stroke-linecap="round" />
                <path d="M12 17v.01" stroke="${accentColor}" stroke-width="2" stroke-linecap="round" />
            </svg>
        </div>
        <h3 style="margin: 0 0 20px; font-size: 22px; font-weight: 600; color: ${accentColor}; line-height: 1.4;">Premium Feature Required</h3>
        <div style="background-color: ${isDarkMode ? '#374151' : '#f8fafc'}; border-radius: 8px; padding: 16px; margin: 0 0 24px;">
            <p style="margin: 0 0 12px; line-height: 1.6; font-size: 16px;">Cloud backup synchronization is a premium feature of Bitabo.</p>
            <p style="margin: 0; line-height: 1.6; font-size: 16px;">To enable this feature, please contact us by clicking:</p>
        </div>
        <div style="margin: 0 auto 16px; max-width: 240px;">
            <a href="mailto:nkasozi@gmail.com" style="display: block; padding: 12px 20px; background: ${accentColor}; color: white; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 16px; transition: all 0.2s ease;">Here Now</a>
        </div>
        <p style="margin: 0; font-size: 14px; color: ${mutedColor};">We'll help you set up your premium subscription.</p>
    </div>
    `;
}