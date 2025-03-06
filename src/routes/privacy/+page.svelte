<script>
  import { onMount } from 'svelte';
  
  let currentYear = new Date().getFullYear();
  
  onMount(() => {
    // Get the current year for copyright notice
    currentYear = new Date().getFullYear();
  });
</script>

<svelte:head>
  <title>Privacy Policy | Bitabo</title>
  <meta name="description" content="Privacy policy for Bitabo e-reader application" />
</svelte:head>

<div class="privacy-container">
  <h1>Privacy Policy</h1>
  <p class="last-updated">Last Updated: {currentYear}</p>

  <section>
    <h2>Introduction</h2>
    <p>
      Welcome to Bitabo ("we," "our," or "us"). We respect your privacy and are committed to protecting your personal data.
      This privacy policy explains how your data is handled when you use our e-reader application.
    </p>
  </section>

  <section>
    <h2>Data Collection and Processing</h2>
    <p>
      <strong>Bitabo operates entirely within your browser.</strong> This means that:
    </p>
    <ul>
      <li>Your e-books and reading materials remain on your device</li>
      <li>Your reading progress, bookmarks, and annotations are stored locally on your device</li>
      <li>We do not transmit your reading materials or reading habits to any server</li>
      <li>No user account is required to use our service</li>
    </ul>
  </section>

  <section>
    <h2>Local Storage</h2>
    <p>
      Bitabo uses your browser's IndexedDB to store:
    </p>
    <ul>
      <li>Your uploaded e-books</li>
      <li>Reading progress</li>
      <li>Any annotations or bookmarks you create</li>
      <li>Display preferences and settings</li>
    </ul>
    <p>
      This data is stored solely on your device and is not transmitted to us or any third parties.
    </p>
  </section>

  <section>
    <h2>Service Workers</h2>
    <p>
      Bitabo uses service workers to enable offline functionality. Service workers store application assets locally to improve performance and allow the application to work without an internet connection.
    </p>
  </section>

  <section>
    <h2>Third-Party Services</h2>
    <p>
      Bitabo does not integrate with any third-party analytics, tracking, or advertising services. We do not use cookies for tracking purposes.
    </p>
  </section>

  <section>
    <h2>Data Security</h2>
    <p>
      Since all data is stored locally on your device, the security of your data depends on:
    </p>
    <ul>
      <li>The security of your device</li>
      <li>The security features of your browser</li>
      <li>Your browser's IndexedDB implementation</li>
    </ul>
    <p>
      We recommend keeping your browser and operating system updated to ensure the best security for your locally stored data.
    </p>
  </section>

  <section>
    <h2>Children's Privacy</h2>
    <p>
      Our service is not directed to individuals under the age of 13. We do not knowingly collect personal information from children under 13.
    </p>
  </section>

  <section>
    <h2>Changes to This Privacy Policy</h2>
    <p>
      We may update our Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page.
    </p>
  </section>

  <section>
    <h2>Contact Us</h2>
    <p>
      If you have any questions about this Privacy Policy, please contact us:
    </p>
    <ul>
      <li>By creating an issue on our GitHub repository</li>
    </ul>
  </section>

  <footer>
    <p class="copyright">© {currentYear} Bitabo E-Reader. All rights reserved.</p>
    <p class="links">
      <a href="/">Home</a> | 
      <a href="/tos">Terms of Service</a>
    </p>
  </footer>
</div>

<style>
  .privacy-container {
    max-width: 800px;
    margin: 0 auto;
    padding: 2rem;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    line-height: 1.5;
    color: #333;
  }

  h1 {
    font-size: 2.5rem;
    margin-bottom: 0.5rem;
    color: #1a365d;
  }

  h2 {
    font-size: 1.5rem;
    margin-top: 2rem;
    margin-bottom: 0.75rem;
    color: #2c5282;
    border-bottom: 1px solid #e2e8f0;
    padding-bottom: 0.5rem;
  }

  .last-updated {
    color: #718096;
    font-style: italic;
    margin-bottom: 2rem;
  }

  p {
    margin-bottom: 1rem;
  }

  ul {
    margin-bottom: 1.5rem;
    padding-left: 2rem;
  }

  li {
    margin-bottom: 0.5rem;
  }

  section {
    margin-bottom: 2rem;
  }

  strong {
    font-weight: 600;
  }

  footer {
    margin-top: 3rem;
    padding-top: 1.5rem;
    border-top: 1px solid #e2e8f0;
    text-align: center;
    font-size: 0.875rem;
    color: #718096;
  }

  .copyright {
    margin-bottom: 0.5rem;
  }

  .links a {
    color: #3182ce;
    text-decoration: none;
  }

  .links a:hover {
    text-decoration: underline;
  }

  /* Responsive adjustments */
  @media (max-width: 640px) {
    .privacy-container {
      padding: 1rem;
    }

    h1 {
      font-size: 2rem;
    }

    h2 {
      font-size: 1.25rem;
    }
  }
</style>