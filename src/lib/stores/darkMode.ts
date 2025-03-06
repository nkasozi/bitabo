import { browser } from '$app/environment';
import { writable } from 'svelte/store';

// Initialize dark mode from localStorage if available, otherwise default to dark mode
function createDarkModeStore() {
  // Default to dark mode unless explicitly set to light mode in localStorage
  
  // Check localStorage for saved preference
  const storedDarkMode = browser ? localStorage.getItem('darkMode') : null;
  const initialValue: boolean = storedDarkMode !== null ? JSON.parse(storedDarkMode) : true; // Default to true (dark mode)
  
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