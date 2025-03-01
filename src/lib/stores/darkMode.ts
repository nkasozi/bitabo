import { browser } from '$app/environment';
import { writable } from 'svelte/store';

// Initialize dark mode from localStorage if available, otherwise use system preference
function createDarkModeStore() {
  // Default to system preference if localStorage is not available
  const prefersDark = browser && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  // Check localStorage for saved preference
  const storedDarkMode = browser && localStorage.getItem('darkMode');
  const initialValue = storedDarkMode !== null ? JSON.parse(storedDarkMode) : prefersDark;
  
  const { subscribe, set, update } = writable(initialValue);
  
  return {
    subscribe,
    toggle: () => {
      update(value => {
        // Save to localStorage when changed
        if (browser) {
          localStorage.setItem('darkMode', JSON.stringify(!value));
        }
        return !value;
      });
    },
    set: (value: boolean) => {
      // Save to localStorage when set explicitly
      if (browser) {
        localStorage.setItem('darkMode', JSON.stringify(value));
      }
      set(value);
    }
  };
}

export const darkMode = createDarkModeStore();