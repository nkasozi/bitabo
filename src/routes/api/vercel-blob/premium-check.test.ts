import { describe, it, expect } from 'vitest';
import { isPremiumUser, extractPrefixFromPathname } from './premium-check';

describe('Premium Check Utilities', () => {
    describe('isPremiumUser', () => {
        it('should return true for known premium prefixes', () => {
            // Act & Assert
            expect(isPremiumUser('kasozi')).toBe(true);
            expect(isPremiumUser('KASOZI')).toBe(true); // Case insensitive
            expect(isPremiumUser('esther')).toBe(true);
            expect(isPremiumUser('ESTHER')).toBe(true); // Case insensitive
        });

        it('should return false for non-premium prefixes', () => {
            // Act & Assert
            expect(isPremiumUser('user123')).toBe(false);
            expect(isPremiumUser('testuser')).toBe(false);
        });

        it('should return false for empty prefix', () => {
            // Act & Assert
            expect(isPremiumUser('')).toBe(false);
        });

        it('should return false for null/undefined prefix', () => {
            // Act & Assert
            expect(isPremiumUser(null as any)).toBe(false);
            expect(isPremiumUser(undefined as any)).toBe(false);
        });
    });

    describe('extractPrefixFromPathname', () => {
        it('should extract prefix from valid pathname', () => {
            // Arrange
            const pathname = 'user123_abcd1234.json';
            
            // Act
            const result = extractPrefixFromPathname(pathname);
            
            // Assert
            expect(result).toBe('user123');
        });

        it('should extract prefix from pathname with multiple underscores', () => {
            // Arrange
            const pathname = 'user_name_abcd1234.json';
            
            // Act
            const result = extractPrefixFromPathname(pathname);
            
            // Assert
            expect(result).toBe('user');
        });

        it('should return null for pathname without underscore', () => {
            // Arrange
            const pathname = 'filename.json';
            
            // Act
            const result = extractPrefixFromPathname(pathname);
            
            // Assert
            expect(result).toBe(null);
        });

        it('should return null for empty pathname', () => {
            // Act & Assert
            expect(extractPrefixFromPathname('')).toBe(null);
        });

        it('should return null for null/undefined pathname', () => {
            // Act & Assert
            expect(extractPrefixFromPathname(null as any)).toBe(null);
            expect(extractPrefixFromPathname(undefined as any)).toBe(null);
        });
    });
});