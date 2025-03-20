<script lang="ts">
  import { onMount } from 'svelte';
  
  let currentYear: number = new Date().getFullYear();
  
  onMount(() => {
    // Get the current year for copyright notice
    currentYear = new Date().getFullYear();
  });
</script>

<svelte:head>
  <title>Terms of Service | Ebitabo</title>
  <meta name="description" content="Terms of Service for Ebitabo e-reader application" />
</svelte:head>

<div class="tos-container">
  <h1>Terms of Service</h1>
  <p class="last-updated">Last Updated: {currentYear}</p>

  <section>
    <h2>Introduction</h2>
    <p>
      Welcome to Ebitabo. These Terms of Service ("Terms") govern your use of our e-reader application and website 
      (collectively, the "Service"). By using our Service, you agree to these Terms. Please read them carefully.
    </p>
  </section>

  <section>
    <h2>Client-Side Application</h2>
    <p>
      <strong>Ebitabo operates entirely within your browser.</strong> This means:
    </p>
    <ul>
      <li>All processing occurs on your device</li>
      <li>Your files and reading data stay on your device</li>
      <li>No account registration is required to use the basic features</li>
    </ul>
  </section>

  <section>
    <h2>Acceptable Use</h2>
    <p>
      You agree not to misuse the Service. For example, you must not:
    </p>
    <ul>
      <li>Use the Service for any illegal purposes</li>
      <li>Attempt to probe, scan, or test the vulnerability of the Service</li>
      <li>Attempt to interfere with the proper working of the Service</li>
      <li>Use the Service in a way that could disable, overburden, or impair it</li>
      <li>Try to gain unauthorized access to the Service, user accounts, or computer systems</li>
    </ul>
  </section>

  <section>
    <h2>Intellectual Property</h2>
    <p>
      Ebitabo respects intellectual property rights. Our Service is designed for you to read e-books that you legally own or have permission to access.
    </p>
    <p>
      You are solely responsible for ensuring that your use of e-books through our Service complies with all applicable copyright laws and the terms under which you acquired those e-books.
    </p>
    <p>
      We do not condone the use of our Service to read illegally obtained e-books.
    </p>
  </section>

  <section>
    <h2>Content Responsibility</h2>
    <p>
      You are entirely responsible for the content you access through our Service. As Ebitabo operates entirely client-side, we do not monitor, review, or have access to the e-books or other content you access through our Service.
    </p>
  </section>

  <section>
    <h2>Service Availability</h2>
    <p>
      We strive to provide a reliable Service, but we do not guarantee that the Service will always be available, uninterrupted, or error-free.
    </p>
  </section>

  <section>
    <h2>Updates and Changes</h2>
    <p>
      We may update or change the Service from time to time. We may also stop providing the Service altogether. We will strive to provide reasonable notice before making significant changes to the Service.
    </p>
  </section>

  <section>
    <h2>Disclaimer of Warranties</h2>
    <p>
      THE SERVICE IS PROVIDED "AS IS," WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED. TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE DISCLAIM ALL WARRANTIES, INCLUDING ANY IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
    </p>
  </section>

  <section>
    <h2>Limitation of Liability</h2>
    <p>
      TO THE MAXIMUM EXTENT PERMITTED BY LAW, IN NO EVENT WILL WE BE LIABLE FOR ANY INDIRECT, CONSEQUENTIAL, EXEMPLARY, INCIDENTAL, SPECIAL, OR PUNITIVE DAMAGES, INCLUDING DAMAGES FOR LOSS OF PROFITS, GOODWILL, USE, DATA, OR OTHER INTANGIBLE LOSSES, ARISING OUT OF OR RELATING TO YOUR USE OF OR INABILITY TO USE THE SERVICE.
    </p>
  </section>

  <section>
    <h2>Changes to Terms</h2>
    <p>
      We may modify these Terms at any time. We will provide notice of significant changes to the Terms, such as by posting a notice on our website or through the Service. Your continued use of the Service after such changes constitutes your acceptance of the new Terms.
    </p>
  </section>

  <section>
    <h2>Governing Law</h2>
    <p>
      These Terms shall be governed by and construed in accordance with the laws of the jurisdiction in which we operate, without regard to its conflict of law provisions.
    </p>
  </section>

  <section>
    <h2>Contact Us</h2>
    <p>
      If you have any questions about these Terms, please contact us:
    </p>
    <ul>
      <li>By creating an issue on our GitHub repository</li>
    </ul>
  </section>

  <footer>
    <p class="copyright">© {currentYear} Ebitabo E-Reader. All rights reserved.</p>
    <p class="links">
      <a href="/">Home</a> | 
      <a href="/privacy">Privacy Policy</a>
    </p>
  </footer>
</div>

<style>
  .tos-container {
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
    .tos-container {
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