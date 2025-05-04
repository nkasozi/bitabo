import {sequence} from '@sveltejs/kit/hooks';
import * as Sentry from '@sentry/sveltekit';

Sentry.init({
    dsn: "https://2446f9cf67e8d77f003ac3d82bb5bbed@o4509262232485888.ingest.de.sentry.io/4509262234320976",
    tracesSampleRate: 1
})

export const handleError = Sentry.handleErrorWithSentry();

export const handle = sequence(
  Sentry.sentryHandle(),
  async function _handle({ event, resolve }) {
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
);