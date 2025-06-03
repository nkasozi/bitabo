import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

let startUrl = 'http://localhost:5174/'

async function dismiss_pwa_install_prompt(page: Page): Promise<void> {
  console.log('[TEST_DEBUG] Checking for PWA install prompt to dismiss...');
  try {
    // First check if the prompt exists and is visible
    const promptVisible = await page.locator('.pwa-install-prompt').isVisible({ timeout: 2000 }).catch(() => false);
    
    if (promptVisible) {
      console.log('[TEST_DEBUG] PWA install prompt found, dismissing it');
      await page.locator('.pwa-install-prompt .close-btn').click().catch(() => {
        console.log('[TEST_DEBUG] Could not click close button, trying fallback method');
        return page.evaluate(() => {
          const closeBtn = document.querySelector('.pwa-install-prompt .close-btn');
          if (closeBtn) (closeBtn as HTMLElement).click();
        });
      });
      
      // Wait for the prompt to disappear
      await page.waitForSelector('.pwa-install-prompt', { state: 'hidden', timeout: 2000 })
        .catch(() => console.log('[TEST_DEBUG] Could not verify prompt dismissed, continuing anyway'));
      
      console.log('[TEST_DEBUG] PWA install prompt dismissed successfully');
    } else {
      console.log('[TEST_DEBUG] No PWA install prompt visible, continuing');
    }
  } catch (error) {
    // Don't fail the test if the PWA prompt couldn't be dismissed
    console.log('[TEST_DEBUG] Error handling PWA prompt (this is not a test failure):', error);
  }
}

async function dismiss_cross_platform_dialog(page: Page): Promise<void> {
  console.log('[TEST_DEBUG] Checking for cross-platform dialog to dismiss...');
  try {
    // Check if the cross-platform dialog is visible (with short timeout)
    const dialogVisible = await page.locator('.crossplatform-content').isVisible({ timeout: 2000 }).catch(() => false);
    
    if (dialogVisible) {
      console.log('[TEST_DEBUG] Cross-platform dialog found, clicking "No, Thanks" button');
      
      // Click the "No, Thanks" button
      await page.locator('button:text("No, Thanks")').click().catch(() => {
        console.log('[TEST_DEBUG] Could not click "No, Thanks" button, trying fallback method');
        return page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('.crossplatform-buttons button'));
          const noThanksButton = buttons.find(btn => btn.textContent?.includes('No, Thanks'));
          if (noThanksButton) (noThanksButton as HTMLElement).click();
        });
      });
      
      // Wait for the dialog to disappear
      await page.waitForSelector('.crossplatform-content', { state: 'hidden', timeout: 2000 })
        .catch(() => console.log('[TEST_DEBUG] Could not verify dialog dismissed, continuing anyway'));
      
      console.log('[TEST_DEBUG] Cross-platform dialog dismissed successfully');
    } else {
      console.log('[TEST_DEBUG] No cross-platform dialog visible, continuing');
    }
  } catch (error) {
    // Don't fail the test if we couldn't dismiss the dialog
    console.log('[TEST_DEBUG] Error handling cross-platform dialog (this is not a test failure):', error);
  }
}

async function navigate_to_library_page(page: Page): Promise<boolean> {
  console.log('[TEST_DEBUG] Navigating to library page: /library');
  await page.goto(startUrl);
  
  await dismiss_pwa_install_prompt(page);
  await dismiss_cross_platform_dialog(page);
  
  const current_url = page.url();
  const success = current_url.includes('/library');
  if (!success) {
    console.error('[TEST_DEBUG] Failed to navigate to library page. Current URL:', current_url);
  }
  return success;
}

async function upload_book_via_input(page: Page, book_file_path: string, book_title: string): Promise<boolean> {
  console.log(`[TEST_DEBUG] Attempting to upload book: ${book_title} from path: ${book_file_path}`);
  
  try {
    // First, click the "Add Books to Your Library" button to open modal
    await page.click('button:text("Add Books to Your Library")', { timeout: 5000 });
    console.log(`[TEST_DEBUG] Clicked 'Add Books to Your Library' button`);
    
    // Then click the "Browse Files" button inside the modal
    await page.click('.upload-modal-content button:text("Browse Files")', { timeout: 5000 });
    console.log(`[TEST_DEBUG] Clicked 'Browse Files' button`);
    
    // This will trigger the file input click which is handled by the app
    // Now we need to set the file in the input element
    await page.setInputFiles('input[type="file"]#file-input', book_file_path, { timeout: 10000 });
    console.log(`[TEST_DEBUG] Successfully set input files for: ${book_title}`);
  } catch (error_instance) {
    console.error(`[TEST_DEBUG] Error during upload process for ${book_title}:`, error_instance);
    const error_message = error_instance instanceof Error ? error_instance.message : String(error_instance);
    await page.evaluate((msg) => console.error(msg), `Playwright Test Error: Upload process failed. Error: ${error_message}`);
    return false;
  }

  // Wait for book processing and library update
  await page.waitForTimeout(3000);
  
  // Dismiss cross-platform dialog if it appears after upload
  await dismiss_cross_platform_dialog(page);
  
  // Check if book was added to library by verifying title appears in book-info
  console.log(`[TEST_DEBUG] Checking if book "${book_title}" appears in the library`);
  
  try {
    // First check in the book-info area, which displays selected book title
    const bookInfoSelector = '.book-info h2.book-title';
    
    // Wait for the book to appear, could be in coverflow or book-info
    await page.waitForFunction(
      (title) => {
        // Check the selected book title in book-info
        const bookInfoTitle = document.querySelector('.book-info h2.book-title');
        if (bookInfoTitle && bookInfoTitle.textContent && bookInfoTitle.textContent.includes(title)) {
          return true;
        }
        
        return false;
      },
      book_title,
      { timeout: 20000 }
    );
    
    // Verify book title appears in book-info
    const titleVisible = await page.evaluate((title) => {
      const bookInfoTitle = document.querySelector('.book-info h2.book-title');
      return bookInfoTitle && bookInfoTitle.textContent && bookInfoTitle.textContent.includes(title);
    }, book_title);
    
    if (titleVisible) {
      console.log(`[TEST_DEBUG] Book "${book_title}" is visible in the book-info section.`);
      return true;
    } else {
      console.warn(`[TEST_DEBUG] Book "${book_title}" was not found in the library.`);
      const library_content = await page.content();
      console.log("[TEST_DEBUG] Current library content for debugging:", library_content.substring(0, 5000));
      return false;
    }
  } catch (error_instance) {
    console.error(`[TEST_DEBUG] Error waiting for book "${book_title}" to appear in library:`, error_instance);
    const library_content = await page.content();
    console.log("[TEST_DEBUG] Current library content after failing to find book:", library_content.substring(0, 5000));
    return false;
  }
}

async function click_book_in_library_and_verify_reader(page: Page, book_title: string): Promise<boolean> {
  console.log(`[TEST_DEBUG] Attempting to click book: ${book_title} in library.`);
  
  try {
    // First ensure the book appears in the book-info section
    await page.waitForFunction(
      (title) => {
        const bookInfoTitle = document.querySelector('.book-info h2.book-title');
        return bookInfoTitle && bookInfoTitle.textContent && bookInfoTitle.textContent.includes(title);
      },
      book_title,
      { timeout: 10000 }
    );
    
    // Once we've confirmed the book is selected, click the "Read Book" button
    await page.click('button:text("Read Book")', { timeout: 10000 });
    console.log(`[TEST_DEBUG] Clicked 'Read Book' button for book: ${book_title}`);
  } catch (error_instance) {
    console.error(`[TEST_DEBUG] Error clicking on Read Book button for "${book_title}":`, error_instance);
    return false;
  }

  // Wait for reader to load using a more reliable selector
  console.log(`[TEST_DEBUG] Waiting for reader view to appear...`);
  
  try {
    // Wait for the page URL to change to /reader
    await page.waitForFunction(
      () => window.location.href.includes('/reader'),
      { timeout: 15000 }
    );
    
    // Wait for reader content to be visible
    const reader_is_visible = await page.evaluate(() => {
      // Check for common reader elements
      const readerContainer = document.querySelector('#ebook-container') || 
                              document.querySelector('.foliate-view') || 
                              document.querySelector('.reader-container');
      return !!readerContainer;
    });
    
    if (reader_is_visible) {
      console.log(`[TEST_DEBUG] Reader view is visible for book: ${book_title}`);
      return true;
    } else {
      console.warn(`[TEST_DEBUG] Reader view not visible for book: ${book_title}`);
      const page_content = await page.content();
      console.log(`[TEST_DEBUG] Current page content:`, page_content.substring(0, 5000));
      return false;
    }
  } catch (error_instance) {
    console.error(`[TEST_DEBUG] Error waiting for reader view for book "${book_title}":`, error_instance);
    const page_content = await page.content();
    console.log(`[TEST_DEBUG] Current page content after error:`, page_content.substring(0, 5000));
    return false;
  }
}

test.describe('Core Application Flows', () => {
  test('should allow a user to upload a book and see it in the library', async ({ page }) => {
    const navigation_successful = await navigate_to_library_page(page);
    expect(navigation_successful, 'Pre-condition: Navigation to library page failed').toBe(true);

    const dummy_book_file_path = 'dummy-book.epub'; 
    const dummy_book_title = 'dummy-book'; 

    const project_root = process.cwd();
    const absolute_dummy_book_file_path = path.join(project_root, dummy_book_file_path);

    if (!fs.existsSync(absolute_dummy_book_file_path)) {
      console.log(`[TEST_DEBUG] Creating dummy file for testing at: ${absolute_dummy_book_file_path}`);
      try {
        fs.writeFileSync(absolute_dummy_book_file_path, 'This is a dummy epub file for testing.');
        console.log(`[TEST_DEBUG] Successfully created dummy file: ${absolute_dummy_book_file_path}`);
      } catch (creation_error) {
        console.error(`[TEST_DEBUG] Failed to create dummy file ${absolute_dummy_book_file_path}:`, creation_error);
        // Fail the test if dummy file cannot be created, as upload will fail.
        expect(false, `Test setup failed: Could not create dummy file at ${absolute_dummy_book_file_path}`).toBe(true);
      }
    } else {
      console.log(`[TEST_DEBUG] Dummy file already exists at: ${absolute_dummy_book_file_path}`);
    }


    const upload_successful = await upload_book_via_input(page, absolute_dummy_book_file_path, dummy_book_title);
    expect(upload_successful, `Uploading book "${dummy_book_title}" failed or book not visible after upload.`).toBe(true);
  });

  test('should allow a user to open a book and view the reader', async ({ page }) => {
    const navigation_successful = await navigate_to_library_page(page);
    expect(navigation_successful, 'Pre-condition: Navigation to library page failed').toBe(true);

    const dummy_book_file_path = 'dummy-book.epub'; 
    const dummy_book_title = 'dummy-book'; 
    const project_root = process.cwd();
    const absolute_dummy_book_file_path = path.join(project_root, dummy_book_file_path);

    // Ensure the book is present by checking book title in book-info section
    let book_is_already_in_library = await page.evaluate((title) => {
      const bookInfoTitle = document.querySelector('.book-info h2.book-title');
      return bookInfoTitle && bookInfoTitle.textContent && bookInfoTitle.textContent.includes(title);
    }, dummy_book_title);

    // If book not found, upload it first
    if (!book_is_already_in_library) {
      console.log(`[TEST_DEBUG] Book "${dummy_book_title}" not found in library, attempting to upload it first for the read test.`);
      if (!fs.existsSync(absolute_dummy_book_file_path)) {
        console.log(`[TEST_DEBUG] Creating dummy file for read test at: ${absolute_dummy_book_file_path}`);
        fs.writeFileSync(absolute_dummy_book_file_path, 'This is a dummy epub file for testing read flow.');
      }
      const upload_for_read_test_successful = await upload_book_via_input(page, absolute_dummy_book_file_path, dummy_book_title);
      expect(upload_for_read_test_successful, 'Pre-condition: Uploading book for read test failed.').toBe(true);
    }
    
    // Verify book is in library after potential upload
    book_is_already_in_library = await page.evaluate((title) => {
      const bookInfoTitle = document.querySelector('.book-info h2.book-title');
      return bookInfoTitle && bookInfoTitle.textContent && bookInfoTitle.textContent.includes(title);
    }, dummy_book_title);
    expect(book_is_already_in_library, `Pre-condition: Book "${dummy_book_title}" must be in the library to test reading.`).toBe(true);

    const reader_opened_successfully = await click_book_in_library_and_verify_reader(page, dummy_book_title);
    expect(reader_opened_successfully, `Opening book "${dummy_book_title}" to reader view failed or reader view not visible.`).toBe(true);
  });
});
