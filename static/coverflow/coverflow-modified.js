/*
 * Simple iTunes-style Coverflow
 * Creates a 3D rotating book showcase with keyboard navigation
 * Responsive design to handle window resizing
 */

(function() {
  'use strict';

  function SimpleCoverflow(container, options) {
    // Configuration with defaults
    const settings = {
      coverSize: parseInt(options?.size || container.dataset.size) || 300,
      spacing: parseInt(options?.spacing || container.dataset.spacing) || 70, // Increased default spacing from 40 to 70
      showReflection: (options?.shadow || container.dataset.shadow) === 'true',
      backgroundColor: options?.bgcolor || container.dataset.bgcolor || 'transparent',
      // Start index will be set to middle item based on number of covers
      startIndex: parseInt(options?.index || container.dataset.index) || 0,
      responsive: (options?.responsive || container.dataset.responsive) !== 'false' // responsive by default
    };
    
    // Collect all image elements
    const covers = Array.from(container.childNodes).filter(node => node.tagName);
    
    // Tracking
    let selectedIndex = settings.startIndex;

    function initializeContainer() {
      // Set the correct height to match original

      // Basic container styling
      container.style.position = 'relative';
      container.style.backgroundColor = settings.backgroundColor;
      container.style.overflow = 'scroll'; // Match original overflow
      container.style.overflowX = 'scroll';
      container.style.perspective = '600px'; // Match original perspective
      container.style.transform = 'rotateY(0deg) translateZ(-5px)';
      container.style.width = '100%';

      // Set data attribute for index tracking
      container.dataset.index = selectedIndex;
    }

    function setupCovers() {
      covers.forEach((cover, index) => {
        // Basic styling for each cover
        cover.style.position = 'absolute';
        cover.style.width = `${settings.coverSize}px`;
        cover.style.height = 'auto';
        cover.style.bottom = '60px'; // Position from bottom
        cover.style.boxShadow = 'rgba(0, 0, 0, 0.3) 0px 10px 30px';
        cover.style.transition = '-webkit-transform 0.4s, margin-left 0.4s, -webkit-filter 0.4s';

        // Remove any reflections
        cover.style.webkitBoxReflect = 'none';

        // Add click event
        const clickHandler = (e) => {
          e.preventDefault();
          e.stopPropagation();
          updateCoverflow(index);
        };
        cover.clickHandler = clickHandler;
        cover.addEventListener('click', clickHandler);
      });
    }

    function positionCover(cover, index, isSelected) {
      const offset = index - selectedIndex;

      // Get current cover size
      const currentCoverSize = cover.offsetWidth || settings.coverSize;

      // Calculate responsive spacing
      let currentSpacing = settings.spacing;
      if (container.offsetWidth < 768) {
        currentSpacing = Math.floor(settings.spacing * 0.6);
      } else if (container.offsetWidth < 1024) {
        currentSpacing = Math.floor(settings.spacing * 0.8);
      }

      // Add a constant for the perspective depth
      const perspectiveDepth = 600;

      // Calculate center position
      const centerX = container.offsetWidth / 2 - currentCoverSize / 2;

      let xPosition, zPosition, rotationY, opacity, zIndex;

      if (offset === 0) {
        // Selected cover
        rotationY = 0;
        xPosition = centerX;
        zPosition = 0;
        opacity = 1;
        zIndex = 1000;
      } else if (offset < 0) {
        // Covers to the left - use progressive transformations
        const absOffset = Math.abs(offset);
        rotationY = Math.min(55 + (absOffset * 5), 90); // Increase angle progressively
        xPosition = centerX - (currentSpacing * absOffset);
        zPosition = -30 * absOffset; // Progressive Z depth
        opacity = 0.7;
        zIndex = 500 - absOffset;
      } else {
        // Covers to the right - use progressive transformations
        rotationY = Math.min(-(55 + (offset * 5)), -55); // Increase angle progressively
        xPosition = centerX + (currentSpacing * offset);
        zPosition = -30 * offset; // Progressive Z depth
        opacity = 0.7;
        zIndex = 500 - offset;
      }

      // Apply transformations - matching original positioning
      cover.style.position = 'absolute';
      cover.style.bottom = '60px'; // Position from bottom like original
      cover.style.top = 'auto'; // Clear top positioning
      cover.style.transform = `rotateY(${rotationY}deg) translateZ(${zPosition}px)`;
      cover.style.filter = offset === 0 ? 'none' : 'brightness(0.7)';
      cover.style.zIndex = zIndex;
      cover.style.left = `${xPosition}px`;

      // Remove any vertical centering
      cover.style.transform = `rotateY(${rotationY}deg) translateZ(${zPosition}px)`;
    }
    
    function updateCoverflow(newIndex) {
      if (newIndex < 0 || newIndex >= covers.length) return;
      
      // Validate the new index is an integer and within range
      newIndex = Math.floor(newIndex);
      if (newIndex < 0) newIndex = 0;
      if (newIndex >= covers.length) newIndex = covers.length - 1;
      
      // Update selected index
      selectedIndex = newIndex;
      container.dataset.index = selectedIndex;
      
      // Position all covers
      covers.forEach((cover, index) => {
        positionCover(cover, index, index === selectedIndex);
      });
      
      // Dispatch event for the selected cover
      const event = new CustomEvent('coverselect', {
        detail: {
          index: selectedIndex,
          element: covers[selectedIndex]
        }
      });
      container.dispatchEvent(event);
    }
    
    // Keyboard navigation is now handled by the parent component
    function setupKeyboardNavigation() {
      // Nothing to set up - keyboard navigation is handled externally
    }
    
    // Handle window resize events to make coverflow responsive
    function setupResponsive() {
      if (!settings.responsive) return;
      
      const handleResize = function() {
        // Calculate responsive cover size based on container width
        const containerWidth = container.offsetWidth;
        
        // For smaller screens, scale down cover size proportionally
        let responsiveCoverSize = settings.coverSize;
        let responsiveSpacing = settings.spacing;
        
        if (containerWidth < 768) {
          // Mobile/small tablet: scale down to 60% of original size
          responsiveCoverSize = Math.floor(settings.coverSize * 0.6);
          responsiveSpacing = Math.floor(settings.spacing * 0.6);
        } else if (containerWidth < 1024) {
          // Tablet/small desktop: scale to 80% of original size
          responsiveCoverSize = Math.floor(settings.coverSize * 0.8);
          responsiveSpacing = Math.floor(settings.spacing * 0.8);
        }
        
        // Update cover styling with new sizes
        covers.forEach(cover => {
          cover.style.width = `${responsiveCoverSize}px`;
        });
        
        // Re-position all covers with the new sizing
        covers.forEach((cover, index) => {
          positionCover(cover, index, index === selectedIndex);
        });
      };
      
      // Set up resize observer for more reliable resize detection
      if (typeof ResizeObserver !== 'undefined') {
        const resizeObserver = new ResizeObserver(handleResize);
        resizeObserver.observe(container);
        
        // Store reference for cleanup
        container.resizeObserver = resizeObserver;
      } else {
        // Fallback to window resize event
        window.addEventListener('resize', handleResize);
        container.resizeHandler = handleResize;
      }
      
      // Run once on initialization
      handleResize();
    }
    
    // Initialize the coverflow
    function initialize() {
      if (!container) {
        console.error("No container element provided");
        return null;
      }
      
      if (covers.length === 0) {
        console.warn("No cover images found in container");
        return null;
      }
      
      // Calculate middle index if no specific startIndex was provided
      if (!options?.index && !container.dataset.index) {
        // If there are covers, select the middle one (for odd numbers)
        // or one of the middle two (for even numbers)
        if (covers.length > 0) {
          selectedIndex = Math.floor(covers.length / 2);
        }
      }
      
      // Setup container, covers, and keyboard navigation
      initializeContainer();
      setupCovers();
      setupKeyboardNavigation();
      
      // Set up responsive behavior
      setupResponsive();
      
      // Initial positioning
      updateCoverflow(selectedIndex);
      
      // Add a delayed second positioning after DOM has stabilized
      // This helps ensure books are centered properly after the browser has fully rendered
      setTimeout(() => {
        updateCoverflow(selectedIndex);
      }, 100);
      
      // Return public API
      return {
        container: container,
        images: covers,
        
        // Get current selected index
        showSelectedCover: function() {
          return selectedIndex;
        },
        
        // Select a specific index
        select: function(index) {
          updateCoverflow(index);
        },
        
        // Clean up
        destroy: function() {
          // Remove resize observers/handlers
          if (container.resizeObserver) {
            container.resizeObserver.disconnect();
          }
          
          if (container.resizeHandler) {
            window.removeEventListener('resize', container.resizeHandler);
          }
          
          // Remove click listeners
          covers.forEach(cover => {
            cover.removeEventListener('click', cover.clickHandler);
          });
        }
      };
    }
    
    // Start initialization and return the result
    return initialize();
  }

  // Export to window
  window.Coverflow = SimpleCoverflow;
  
  // Auto-initialize on load
  window.addEventListener('load', function() {
    const coverflows = document.getElementsByClassName('coverflow');
    
    for (let i = 0; i < coverflows.length; i++) {
      const element = coverflows[i];
      
      // Check if it has children and isn't already initialized
      const hasChildren = Array.from(element.childNodes).some(node => node.tagName);
      
      if (hasChildren && !element._initialized) {
        try {
          SimpleCoverflow(element);
          element._initialized = true;
        } catch (err) {
          console.error('Error initializing coverflow:', err);
        }
      }
    }
  });
})();