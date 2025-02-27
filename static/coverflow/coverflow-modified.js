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
      spacing: parseInt(options?.spacing || container.dataset.spacing) || 40,
      showReflection: (options?.shadow || container.dataset.shadow) === 'true',
      backgroundColor: options?.bgcolor || container.dataset.bgcolor || 'transparent',
      startIndex: parseInt(options?.index || container.dataset.index) || 0,
      responsive: (options?.responsive || container.dataset.responsive) !== 'false' // responsive by default
    };
    
    // Collect all image elements
    const covers = Array.from(container.childNodes).filter(node => node.tagName);
    
    // Tracking
    let selectedIndex = settings.startIndex;
    let titleElement = null;
    
    function initializeContainer() {
      console.log("Setting up coverflow container");
      
      // Always set a fixed height to fix the 80px issue
      container.style.height = settings.showReflection ? '400px' : '350px';
      
      // Basic container styling
      container.style.position = 'relative';
      container.style.backgroundColor = 'transparent'; // Force transparency
      container.style.overflow = 'hidden';
      container.style.perspective = '1000px';
      container.style.transformStyle = 'preserve-3d';
      
      // For perspective origin
      container.style.perspectiveOrigin = '50% 50%';
      
      // Create a container for the books to allow proper centering
      const innerContainer = document.createElement('div');
      innerContainer.className = 'coverflow-inner';
      innerContainer.style.position = 'absolute';
      innerContainer.style.width = '100%';
      innerContainer.style.height = '100%';
      innerContainer.style.left = '0';
      innerContainer.style.top = '0';
      innerContainer.style.transformStyle = 'preserve-3d';
      innerContainer.style.backgroundColor = 'transparent';
      
      // Move all existing children to the inner container
      while (container.childNodes.length > 0) {
        innerContainer.appendChild(container.childNodes[0]);
      }
      
      container.appendChild(innerContainer);
      
      // Create title display
      titleElement = document.createElement('div');
      titleElement.className = 'coverflow-title';
      titleElement.style.position = 'absolute';
      titleElement.style.bottom = '20px';
      titleElement.style.left = '0';
      titleElement.style.width = '100%';
      titleElement.style.textAlign = 'center';
      titleElement.style.color = '#333';
      titleElement.style.fontSize = '16px';
      titleElement.style.fontWeight = 'bold';
      
      container.appendChild(titleElement);
      
      // Store inner container reference
      container.innerContainer = innerContainer;
      
      // Set data attribute for index tracking
      container.dataset.index = selectedIndex;
    }
    
    function setupCovers() {
      console.log(`Setting up ${covers.length} covers`);
      
      covers.forEach((cover, index) => {
        // Basic styling for each cover
        cover.style.position = 'absolute';
        cover.style.width = `${settings.coverSize}px`;
        cover.style.height = 'auto';
        cover.style.transition = 'all 0.4s ease';
        cover.style.transformOrigin = 'center center';
        cover.style.cursor = 'pointer';
        
        // Add reflection if enabled and make background transparent
        if (settings.showReflection) {
          cover.style.webkitBoxReflect = 'below 0px -webkit-gradient(linear, left top, left bottom, from(transparent), color-stop(0.7, transparent), to(rgba(0, 0, 0, 0.4)))';
        } else {
          cover.style.boxShadow = '0 5px 20px rgba(0,0,0,0.3)';
        }
        
        // Make background transparent
        cover.style.backgroundColor = 'transparent';
        
        // Add click event - only select the book, don't open it
        cover.addEventListener('click', (e) => {
          // Prevent any default behavior or bubbling
          e.preventDefault();
          e.stopPropagation();
          
          // Just update the coverflow selection
          updateCoverflow(index);
          
          // Log for debugging
          console.log(`Clicked on cover at index ${index}, only selecting, not opening`);
        });
      });
    }
    
    function positionCover(cover, index, isSelected) {
      const offset = index - selectedIndex;
      
      // Get current cover size - either from the element's width or from settings
      const currentCoverSize = cover.offsetWidth || settings.coverSize;
      
      // Calculate responsive spacing based on container width
      let currentSpacing = settings.spacing;
      if (container.offsetWidth < 768) {
        currentSpacing = Math.floor(settings.spacing * 0.6);
      } else if (container.offsetWidth < 1024) {
        currentSpacing = Math.floor(settings.spacing * 0.8);
      }
      
      // Center position calculation
      const centerX = container.offsetWidth / 2 - currentCoverSize / 2;
      const centerY = container.offsetHeight / 2 - (cover.offsetHeight || currentCoverSize) / 2;
      
      // Different transformations based on position
      let xPosition, zPosition, rotationY, opacity;
      
      if (offset < 0) {
        // Covers to the left
        rotationY = 55;
        xPosition = centerX - (Math.abs(offset) * currentSpacing);
        zPosition = -200;
        opacity = 0.5;
      } else if (offset > 0) {
        // Covers to the right
        rotationY = -55;
        xPosition = centerX + (offset * currentSpacing);
        zPosition = -200;
        opacity = 0.5;
      } else {
        // Currently selected cover
        rotationY = 0;
        xPosition = centerX;
        zPosition = 0;
        opacity = 1;
      }
      
      // Apply transitions
      cover.style.transform = `translateX(${xPosition}px) translateZ(${zPosition}px) rotateY(${rotationY}deg)`;
      cover.style.opacity = opacity;
      cover.style.zIndex = offset === 0 ? 1000 : 500 - Math.abs(offset);
      
      // Set vertical position
      cover.style.top = `${centerY}px`;
      
      // Show title of selected cover
      if (isSelected && cover.dataset.info) {
        titleElement.textContent = cover.dataset.info;
      }
    }
    
    function updateCoverflow(newIndex) {
      if (newIndex < 0 || newIndex >= covers.length) return;
      
      console.log(`Updating coverflow to index ${newIndex}, total covers: ${covers.length}`);
      
      // Validate the new index is an integer and within range
      newIndex = Math.floor(newIndex);
      if (newIndex < 0) newIndex = 0;
      if (newIndex >= covers.length) newIndex = covers.length - 1;
      
      console.log(`Using validated index ${newIndex}`);
      
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
    
    function setupKeyboardNavigation() {
      const handleKeydown = function(event) {
        if (event.key === 'ArrowLeft' && selectedIndex > 0) {
          console.log(`ArrowLeft pressed, current index: ${selectedIndex}, moving to ${selectedIndex - 1}`);
          updateCoverflow(selectedIndex - 1);
          event.preventDefault();
        } else if (event.key === 'ArrowRight' && selectedIndex < covers.length - 1) {
          console.log(`ArrowRight pressed, current index: ${selectedIndex}, moving to ${selectedIndex + 1}`);
          updateCoverflow(selectedIndex + 1);
          event.preventDefault();
        }
      };
      
      document.addEventListener('keydown', handleKeydown);
      
      // Store reference for cleanup later
      container.keyboardHandler = handleKeydown;
    }
    
    // Handle window resize events to make coverflow responsive
    function setupResponsive() {
      if (!settings.responsive) return;
      
      const handleResize = function() {
        console.log('Window resized, updating coverflow layout');
        
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
        
        console.log(`Responsive sizing: width=${containerWidth}, coverSize=${responsiveCoverSize}, spacing=${responsiveSpacing}`);
        
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
      console.log("Initializing coverflow");
      
      if (!container) {
        console.error("No container element provided");
        return null;
      }
      
      if (covers.length === 0) {
        console.warn("No cover images found in container");
        return null;
      }
      
      // Setup container, covers, and keyboard navigation
      initializeContainer();
      setupCovers();
      setupKeyboardNavigation();
      
      // Set up responsive behavior
      setupResponsive();
      
      // Initial positioning
      updateCoverflow(selectedIndex);
      
      // Return public API
      return {
        container: container,
        images: covers,
        titleBox: titleElement,
        
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
          // Remove keyboard handler
          document.removeEventListener('keydown', container.keyboardHandler);
          
          // Remove resize observers/handlers
          if (container.resizeObserver) {
            container.resizeObserver.disconnect();
          }
          
          if (container.resizeHandler) {
            window.removeEventListener('resize', container.resizeHandler);
          }
          
          // Remove click listeners
          covers.forEach(cover => {
            cover.onclick = null;
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
    console.log('Auto-initializing coverflow elements');
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