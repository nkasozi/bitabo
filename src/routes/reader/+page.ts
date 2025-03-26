// Reader must be client-side rendered but we want it to be prerendered as a static page
export const prerender = true;
export const ssr = false;

import type { PageLoad } from './$types';

// Set up default data for the reader page
export const load: PageLoad = async ({ params, url }) => {
  const bookId = url.searchParams.get('bookId');
  
  return {
    bookId,
    bookInfo: {
      title: 'Loading Book...',
      author: '',
      id: bookId || '',
      progress: 0
    }
  };
};