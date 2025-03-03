/** @type {import('@sveltejs/kit').Handle} */
export async function handle({ event, resolve }) {
  // Handle direct requests for index.html by redirecting to root
  if (event.url.pathname === '/index.html') {
    return Response.redirect(`${event.url.origin}/`, 301);
  }
  
  // Redirect root path to library
  if (event.url.pathname === '/') {
    return Response.redirect(`${event.url.origin}/library`, 301);
  }

  const response = await resolve(event);
  return response;
}