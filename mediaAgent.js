// Media Agent - Content script that controls media elements in each tab
(function() {
  'use strict';

  // Use browser API (Firefox) or chrome API (Chrome) for cross-compatibility
  const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

  // Prevent multiple injections
  if (window.hasMediaAgent) {
    return;
  }
  window.hasMediaAgent = true;

  class MediaAgent {
    constructor() {
      this.mediaElement = null;
      this.sessionId = null;
      this.updateThrottle = null;
      this.frameId = 0;
      this.retryCount = 0;
      this.isVirtual = false;
      
      this.init();
    }

    async init() {
      // Get frame ID and tab ID from background
      try {
        const response = await browserAPI.runtime.sendMessage({ type: 'GET_TAB_ID' });
        const tabId = response?.tabId || 0;
        this.frameId = window === window.top ? 0 : Math.floor(Math.random() * 1000000);
        this.sessionId = `${tabId}:${this.frameId}`;
      } catch (error) {
        console.error('Error getting tab ID:', error);
        this.sessionId = `unknown:${Math.floor(Math.random() * 1000000)}`;
      }
      
      // Find and attach to media element
      this.findAndAttachMedia();
      
      // Listen for dynamic media elements
      this.observeMediaElements();
      
      // Listen for control messages from background
      browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'MEDIA_CONTROL' && 
            (message.frameId === this.frameId || message.frameId === undefined)) {
          this.handleControlCommand(message.cmd, message.params);
          sendResponse({ success: true });
        }
      });

      console.log('MediaAgent initialized for frame', this.frameId);
    }

    findAndAttachMedia() {
      console.log('MediaAgent: Searching for media elements...');
      
      // First try standard media elements
      let mediaElements = document.querySelectorAll('video, audio');
      console.log('MediaAgent: Found', mediaElements.length, 'standard media elements');
      
      // Special handling for Spotify and other web players
      if (mediaElements.length === 0 && this.isSpotify()) {
        console.log('MediaAgent: Spotify detected, using virtual media element');
        this.createSpotifyVirtualElement();
        return;
      }
      
      let bestElement = null;
      let bestScore = -1;

      for (const element of mediaElements) {
        const score = this.scoreMediaElement(element);
        console.log('MediaAgent: Element score:', score, element);
        if (score > bestScore) {
          bestScore = score;
          bestElement = element;
        }
      }

      if (bestElement && bestScore >= 0) {
        console.log('MediaAgent: Attaching to best element:', bestElement, 'score:', bestScore);
        this.attachToElement(bestElement);
      } else if (this.retryCount < 5) {
        this.retryCount++;
        console.log('MediaAgent: No suitable elements found, retrying in 2s (attempt', this.retryCount, ')');
        setTimeout(() => this.findAndAttachMedia(), 2000);
      }
    }

    isSpotify() {
      return window.location.hostname.includes('spotify.com');
    }

    createSpotifyVirtualElement() {
      console.log('MediaAgent: Creating Spotify virtual element');
      
      const virtualElement = {
        tagName: 'SPOTIFY_VIRTUAL',
        paused: true,
        muted: false,
        volume: 1,
        currentTime: 0,
        duration: 0,
        seekable: { length: 1 }, // Enable seeking
        readyState: 4,
        isVirtual: true,
        
        play: () => {
          console.log('MediaAgent: Spotify virtual play');
          this.spotifyAction('play');
          return Promise.resolve();
        },
        
        pause: () => {
          console.log('MediaAgent: Spotify virtual pause');
          this.spotifyAction('pause');
        },
        
        // Add volume and seek support
        set currentTime(time) {
          console.log('MediaAgent: Spotify seek to:', time);
          this.spotifySeek(time);
        },
        
        get currentTime() {
          return this._currentTime || 0;
        },
        
        set volume(vol) {
          console.log('MediaAgent: Spotify volume set to:', vol);
          this.spotifySetVolume(vol);
          this._volume = vol;
        },
        
        get volume() {
          return this._volume || 1;
        },
        
        set muted(mute) {
          console.log('MediaAgent: Spotify mute set to:', mute);
          this.spotifySetMute(mute);
          this._muted = mute;
        },

      };

      this.isVirtual = true;
      this.attachToElement(virtualElement);
      this.startSpotifyMonitoring();
    }

    spotifyAction(action) {
      // Try keyboard space on focused element
      try {
        const activeEl = document.activeElement || document.body;
        activeEl.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', keyCode: 32, bubbles: true, cancelable: true }));
        activeEl.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', keyCode: 32, bubbles: true, cancelable: true }));
      } catch (e) {
        console.warn('MediaAgent: keyboard event dispatch failed', e);
      }

      // Also try clicking play/pause buttons with robust dispatch
      const selectors = [
        '[data-testid="control-button-playpause"]',
        '[aria-label*="Play"]',
        '[aria-label*="Pause"]',
        '.control-button',
        '.player-controls button'
      ];

      const dispatchClick = (el) => {
        try {
          el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0 }));
          el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          return true;
        } catch (err) {
          try { el.click(); return true; } catch (e) { return false; }
        }
      };

      for (const selector of selectors) {
        const button = document.querySelector(selector);
        if (button) {
          console.log('MediaAgent: Clicking Spotify button via selector:', selector, button);
          if (dispatchClick(button)) return;
        }
      }

      // Support next/previous actions
      if (action === 'next' || action === 'previous') {
        const nextSelectors = [
          '[data-testid="control-button-skip-forward"]',
          '[data-testid="control-button-next"]',
          '[aria-label*="Next"]',
          '.next-button',
          '.spoticon-skip-forward'
        ];
        const prevSelectors = [
          '[data-testid="control-button-skip-back"]',
          '[data-testid="control-button-previous"]',
          '[aria-label*="Previous"]',
          '.prev-button',
          '.spoticon-skip-back'
        ];

        const list = action === 'next' ? nextSelectors : prevSelectors;
        for (const sel of list) {
          const btn = document.querySelector(sel);
          if (btn) {
            console.log('MediaAgent: Clicking Spotify next/prev via selector:', sel, btn);
            if (dispatchClick(btn)) return;
          }
        }
      }

      // As a last resort, attempt elementFromPoint near center of player controls
      const playerArea = document.querySelector('[data-testid="now-playing-widget"]') || document.querySelector('.now-playing') || document.querySelector('.player-controls');
      if (playerArea) {
        const rect = playerArea.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const el = document.elementFromPoint(cx, cy);
        if (el) {
          console.log('MediaAgent: Falling back to elementFromPoint click on', el);
          dispatchClick(el);
        }
      }
    }

    spotifySeek(time) {
      console.log('MediaAgent: Spotify seek to time:', time);
      
      if (!this.mediaElement || !this.mediaElement.duration) {
        console.log('MediaAgent: Cannot seek - no duration available');
        return;
      }
      
      // Calculate percentage
      const percentage = Math.max(0, Math.min(1, time / this.mediaElement.duration));
      
      // Try multiple selectors for Spotify's progress bar
      const progressSelectors = [
        '[data-testid="progress-bar"]',
        '.progress-bar',
        '.playback-bar__progress-time',
        '.playback-bar .progress-bar',
        '[role="progressbar"]'
      ];
      
      let progressBar = null;
      for (const selector of progressSelectors) {
        progressBar = document.querySelector(selector);
        if (progressBar) {
          console.log('MediaAgent: Found progress bar with selector:', selector);
          break;
        }
      }
      
      if (progressBar) {
        // Try different interaction methods
        const rect = progressBar.getBoundingClientRect();
        const clickX = rect.left + (rect.width * percentage);
        const clickY = rect.top + (rect.height / 2);

        console.log('MediaAgent: Attempting seek on progress bar at', (percentage * 100).toFixed(2) + '%', 'coords', clickX, clickY);

        // Helper to dispatch Pointer + Mouse events at coordinates
        const dispatchPointerAndMouse = (targetEl, x, y) => {
          try {
            const pointerDown = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true });
            const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y });
            targetEl.dispatchEvent(pointerDown);
            targetEl.dispatchEvent(mouseDown);

            const pointerMove = new PointerEvent('pointermove', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true });
            const mouseMove = new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: x, clientY: y });
            targetEl.dispatchEvent(pointerMove);
            targetEl.dispatchEvent(mouseMove);

            const pointerUp = new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true });
            const mouseUp = new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: x, clientY: y });
            targetEl.dispatchEvent(pointerUp);
            targetEl.dispatchEvent(mouseUp);

            // Also send a click for good measure
            const click = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y });
            targetEl.dispatchEvent(click);
            return true;
          } catch (err) {
            console.warn('MediaAgent: dispatchPointerAndMouse failed', err);
            return false;
          }
        };

        // Method A: dispatch events directly on the progressBar element
        let success = dispatchPointerAndMouse(progressBar, clickX, clickY);

        // Method B: use elementFromPoint at the coordinates and click that node (some React handlers need the real target)
        if (!success) {
          const elAtPoint = document.elementFromPoint(clickX - window.scrollX, clickY - window.scrollY) || document.elementFromPoint(clickX, clickY);
          if (elAtPoint) {
            console.log('MediaAgent: elementFromPoint target:', elAtPoint, 'dispatching events on it');
            success = dispatchPointerAndMouse(elAtPoint, clickX, clickY);
            try { elAtPoint.click(); } catch (e) {}
          }
        }

        // Method C: set hidden slider value if present
        if (!success) {
          const hiddenSlider = progressBar.querySelector('input[type="range"]') || document.querySelector('input[type="range"][data-testid*="progress"]');
          if (hiddenSlider) {
            const min = parseFloat(hiddenSlider.min) || 0;
            const max = parseFloat(hiddenSlider.max) || 100;
            const newValue = min + (percentage * (max - min));
            console.log('MediaAgent: Setting hidden slider value to:', newValue);
            hiddenSlider.value = newValue;
            hiddenSlider.dispatchEvent(new Event('input', { bubbles: true }));
            hiddenSlider.dispatchEvent(new Event('change', { bubbles: true }));
            success = true;
          }
        }

        // Method D: try clicking on a child element inside the progress bar
        if (!success) {
          const clickableChild = progressBar.querySelector('button, a, [role="button"]');
          if (clickableChild) {
            console.log('MediaAgent: Clicking child element inside progress bar:', clickableChild);
            try { clickableChild.click(); success = true; } catch (e) { console.warn('MediaAgent: child click failed', e); }
          }
        }

        if (success) {
          // Update virtual element
          this.mediaElement._currentTime = time;
          console.log('MediaAgent: Seek dispatch attempted - success flag true');
        } else {
          console.warn('MediaAgent: All seek methods failed - could not control progress bar');
        }
      } else {
        console.log('MediaAgent: No progress bar found for seeking');
      }
    }

    spotifySetVolume(volume) {
      console.log('MediaAgent: Spotify set volume to:', volume);
      
      // Try to find volume slider
      const volumeSlider = document.querySelector('[data-testid="volume-bar"]') ||
                          document.querySelector('.volume-slider') ||
                          document.querySelector('.volume-bar input');
      
      if (volumeSlider) {
        // If it's a range input, set value
        if (volumeSlider.type === 'range') {
          const min = parseFloat(volumeSlider.min) || 0;
          const max = parseFloat(volumeSlider.max) || 100;
          const newValue = min + (Math.max(0, Math.min(1, volume)) * (max - min));
          console.log('MediaAgent: Setting range slider to', newValue);
          volumeSlider.value = newValue;
          volumeSlider.dispatchEvent(new Event('input', { bubbles: true }));
          volumeSlider.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          // Try multiple interaction methods: click via elementFromPoint, pointer events
          const rect = volumeSlider.getBoundingClientRect();
          const clickX = rect.left + (rect.width * Math.max(0, Math.min(1, volume)));
          const clickY = rect.top + (rect.height / 2);

          const attemptClick = (el, x, y) => {
            try {
              el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }));
              el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y }));
              el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
              el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y }));
              el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
              return true;
            } catch (err) {
              console.warn('MediaAgent: attemptClick failed for volume', err);
              return false;
            }
          };

          let success = attemptClick(volumeSlider, clickX, clickY);
          if (!success) {
            const elAt = document.elementFromPoint(clickX - window.scrollX, clickY - window.scrollY) || document.elementFromPoint(clickX, clickY);
            if (elAt) success = attemptClick(elAt, clickX, clickY);
          }
        }
      }

      // Ensure virtual element state updated and notify popup
      try {
        if (this.mediaElement && this.mediaElement.isVirtual) {
          this.mediaElement._volume = Math.max(0, Math.min(1, volume));
          // Do not auto-toggle _muted here; reflect if volume zero
          if (this.mediaElement._volume === 0) this.mediaElement._muted = true;
          try { this.sendSpotifyUpdate(); } catch (e) { console.warn('sendSpotifyUpdate failed after spotifySetVolume', e); }
        }
      } catch (e) {
        console.warn('MediaAgent: error updating virtual volume', e);
      }
    }

    spotifySetMute(muted) {
      console.log('MediaAgent: Spotify set mute to:', muted);
      
      // Try to find mute button
      const muteButton = document.querySelector('[data-testid="volume-button"]') ||
                        document.querySelector('[aria-label*="Mute"]') ||
                        document.querySelector('[aria-label*="Unmute"]') ||
                        document.querySelector('.volume-icon');

      // If we have a target mute state, determine current and only click if different
      try {
        const getCurrentMuted = () => {
          try {
            const volInput = document.querySelector('[data-testid="volume-bar"] input') || document.querySelector('.volume-bar input') || document.querySelector('input[type="range"][aria-label*="volume"]');
            if (volInput) return parseFloat(volInput.value) === 0;
            const aria = (muteButton && muteButton.getAttribute('aria-label') || '').toLowerCase();
            if (aria.includes('unmute')) return true; // label shows action to unmute -> currently muted
            if (aria.includes('mute')) return false; // label shows action to mute -> currently unmuted
          } catch (e) { /* ignore */ }
          return !!(this.mediaElement && this.mediaElement._muted);
        };

        const currentlyMuted = getCurrentMuted();
        if (typeof muted === 'boolean') {
          if (currentlyMuted !== muted) {
            if (muteButton) {
              try { muteButton.click(); } catch(e) { try { muteButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch(_) {} }
            }
          }
        } else {
          // toggle
          if (muteButton) {
            try { muteButton.click(); } catch(e) { try { muteButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch(_) {} }
          }
        }

        // After UI action, re-detect state and broadcast
        setTimeout(() => {
          try {
            this.checkSpotifyState();
            this.sendSpotifyUpdate();
          } catch (e) {
            console.warn('MediaAgent: error re-detecting spotify mute after click', e);
          }
        }, 150);
      } catch (e) {
        console.warn('MediaAgent: spotifySetMute failed', e);
      }
    }

    startSpotifyMonitoring() {
      console.log('MediaAgent: Starting Spotify monitoring');
      
      // Monitor for play state changes
      setInterval(() => {
        this.checkSpotifyState();
      }, 1000);
      
      // Monitor for metadata changes
      this.observeSpotifyChanges();
    }

    debugSpotifyTimeElements() {
      console.log('=== Spotify Time Elements Debug ===');
      
      // Check all potential time elements
      const allTimeElements = document.querySelectorAll('[data-testid*="playback"], [data-testid*="time"], .time, .duration, .progress');
      console.log('All potential time elements:', allTimeElements);
      
      allTimeElements.forEach((el, index) => {
        console.log(`Element ${index}:`, {
          selector: el.tagName + (el.id ? '#' + el.id : '') + (el.className ? '.' + el.className.replace(/\s+/g, '.') : ''),
          testId: el.getAttribute('data-testid'),
          ariaLabel: el.getAttribute('aria-label'),
          textContent: el.textContent,
          innerHTML: el.innerHTML
        });
      });
      
      // Check playback bar area
      const playbackBar = document.querySelector('[data-testid*="playback"]') || document.querySelector('.playback-bar');
      if (playbackBar) {
        console.log('Playback bar found:', playbackBar);
        const timeElements = playbackBar.querySelectorAll('*');
        timeElements.forEach((el, index) => {
          if (el.textContent && el.textContent.match(/\d+:\d+/)) {
            console.log(`Time element in playback bar ${index}:`, el.textContent, el);
          }
        });
      }
      
      console.log('=== End Debug ===');
    }

    checkSpotifyState() {
      // Debug time elements on first run
      if (!this._debugged) {
        this._debugged = true;
        this.debugSpotifyTimeElements();
      }
      
      // Check if music is playing by looking for pause button vs play button
      const pauseButton = document.querySelector('[data-testid="control-button-playpause"][aria-label*="Pause"]');
      const playButton = document.querySelector('[data-testid="control-button-playpause"][aria-label*="Play"]');
      
      const isPlaying = !!pauseButton;
      const isPaused = !!playButton;
      
      // Get progress information with multiple selector attempts
      const progressTime = document.querySelector('[data-testid="playback-position"]') ||
                          document.querySelector('.playback-bar__progress-time') ||
                          document.querySelector('.progress-time-elapsed') ||
                          document.querySelector('[aria-label*="elapsed"]');
                          
      const durationTime = document.querySelector('[data-testid="playback-duration"]') ||
                          document.querySelector('.playback-bar__duration') ||
                          document.querySelector('.progress-time-remaining') ||
                          document.querySelector('[aria-label*="duration"]');
      
      let currentTime = 0;
      let duration = 0;
      
      if (progressTime && progressTime.textContent) {
        currentTime = this.parseTimeString(progressTime.textContent);
        console.log('MediaAgent: Found progress time:', progressTime.textContent, '=', currentTime, 'seconds');
      } else {
        console.log('MediaAgent: No progress time element found');
      }
      
      if (durationTime && durationTime.textContent) {
        duration = this.parseTimeString(durationTime.textContent);
        console.log('MediaAgent: Found duration time:', durationTime.textContent, '=', duration, 'seconds');
      } else {
        console.log('MediaAgent: No duration time element found');
      }
      
      if (this.mediaElement && this.mediaElement.isVirtual) {
        const wasPlaying = !this.mediaElement.paused;
        this.mediaElement.paused = isPaused;
        this.mediaElement._currentTime = currentTime;
        this.mediaElement.duration = duration;

        // Try to detect volume/mute from page controls and sync virtual state
        try {
          const volInput = document.querySelector('[data-testid="volume-bar"] input') || document.querySelector('.volume-bar input') || document.querySelector('input[type="range"][aria-label*="volume"]');
          if (volInput && typeof volInput.value !== 'undefined') {
            const min = parseFloat(volInput.min) || 0;
            const max = parseFloat(volInput.max) || 100;
            const val = parseFloat(volInput.value);
            const detectedVolume = (val - min) / (max - min || 1);
            this.mediaElement._volume = Math.max(0, Math.min(1, detectedVolume));
          }

          const muteBtn = document.querySelector('[data-testid="volume-button"]') || document.querySelector('[aria-label*="Mute"]') || document.querySelector('[aria-label*="Unmute"]');
          if (muteBtn) {
            const aria = (muteBtn.getAttribute('aria-label') || '').toLowerCase();
            // aria-label describes the action the button will perform when clicked.
            // "Unmute" label means the player is currently muted (button will unmute it).
            // "Mute" label means the player is currently unmuted (button will mute it).
            if (aria.includes('unmute')) {
              this.mediaElement._muted = true;
            } else if (aria.includes('mute')) {
              this.mediaElement._muted = false;
            }
          }
        } catch (e) {
          console.warn('MediaAgent: error detecting spotify volume/mute', e);
        }

        // Send update if state changed or regularly for progress
        if (wasPlaying !== isPlaying || isPlaying) {
          console.log('MediaAgent: Spotify state changed, playing:', isPlaying, 'progress:', currentTime, '/', duration, 'volume:', this.mediaElement._volume, 'muted:', this.mediaElement._muted);
          this.sendSpotifyUpdate();
        }
      }
    }

    parseTimeString(timeStr) {
      // Parse time strings like "1:23", "0:45", or "1:23:45" to seconds
      if (!timeStr) return 0;
      
      const cleanStr = timeStr.trim().replace(/[^\d:]/g, ''); // Remove non-digits and non-colons
      const parts = cleanStr.split(':');
      
      if (parts.length === 2) {
        // MM:SS format
        const minutes = parseInt(parts[0], 10) || 0;
        const seconds = parseInt(parts[1], 10) || 0;
        return minutes * 60 + seconds;
      } else if (parts.length === 3) {
        // HH:MM:SS format
        const hours = parseInt(parts[0], 10) || 0;
        const minutes = parseInt(parts[1], 10) || 0;
        const seconds = parseInt(parts[2], 10) || 0;
        return hours * 3600 + minutes * 60 + seconds;
      }
      
      console.log('MediaAgent: Could not parse time string:', timeStr);
      return 0;
    }

    observeSpotifyChanges() {
      // Watch for DOM changes that indicate track changes
      const observer = new MutationObserver(() => {
        if (this.mediaElement && this.mediaElement.isVirtual) {
          this.sendSpotifyUpdate();
        }
      });
      
      const trackInfo = document.querySelector('[data-testid="now-playing-widget"]') || 
                        document.querySelector('.now-playing') ||
                        document.body;
      
      if (trackInfo) {
        observer.observe(trackInfo, { 
          childList: true, 
          subtree: true,
          attributes: true,
          attributeFilter: ['aria-label']
        });
      }
    }

    sendSpotifyUpdate() {
      // Get current track info
      const trackName = document.querySelector('[data-testid="context-item-link"]')?.textContent ||
                        document.querySelector('.track-info__name')?.textContent ||
                        'Unknown Track';
      
      const artistName = document.querySelector('[data-testid="context-item-info-artist"]')?.textContent ||
                         document.querySelector('.track-info__artists')?.textContent ||
                         'Unknown Artist';
      
      const pauseButton = document.querySelector('[data-testid="control-button-playpause"][aria-label*="Pause"]');
      const isPlaying = !!pauseButton;
      
      // Get progress info from virtual media element
      let currentTime = 0;
      let duration = 0;
      let volume = 1;
      let muted = false;
      
      if (this.mediaElement && this.mediaElement.isVirtual) {
        currentTime = this.mediaElement._currentTime || 0;
        duration = this.mediaElement.duration || 0;
        volume = this.mediaElement._volume || 1;
        muted = this.mediaElement._muted || false;
      }
      
      const sessionData = {
        title: `${trackName} - ${artistName}`,
        artworkUrl: null,
        state: {
          paused: !isPlaying,
          muted: muted,
          volume: volume,
          currentTime: currentTime,
          duration: duration,
          canSeek: duration > 0,
          ended: false
        }
      };

      if (this._seekInProgress) {
        console.log('MediaAgent: Skipping Spotify update while seek in progress');
        return;
      }

      console.log('MediaAgent: Sending Spotify update:', sessionData);
      browserAPI.runtime.sendMessage({
        type: 'SESSION_UPDATE',
        data: sessionData
      }).catch(error => {
        console.error('Error sending session update:', error);
      });
    }

    scoreMediaElement(element) {
      let score = 0;

      if (element.disableRemotePlayback) return -1;
      if (element.readyState === 0) score -= 10;
      if (!element.paused) score += 100;
      if (element.currentTime > 0) score += 50;
      if (element.duration && !isNaN(element.duration)) {
        score += Math.min(element.duration / 60, 30);
      }
      if (element.offsetWidth > 0 && element.offsetHeight > 0) score += 20;
      if (element.tagName === 'VIDEO') score += 10;
      if (!element.muted) score += 10;
      if (element.src || element.children.length > 0) score += 5;

      return score;
    }

    attachToElement(element) {
      this.detachFromElement();
      this.mediaElement = element;
      
      if (!element.isVirtual) {
        element.addEventListener('play', this.handleMediaEvent.bind(this));
        element.addEventListener('pause', this.handleMediaEvent.bind(this));
        element.addEventListener('timeupdate', this.handleTimeUpdate.bind(this));
        element.addEventListener('durationchange', this.handleMediaEvent.bind(this));
        element.addEventListener('volumechange', this.handleMediaEvent.bind(this));
        element.addEventListener('seeked', this.handleMediaEvent.bind(this));
        element.addEventListener('emptied', this.handleMediaEvent.bind(this));
        element.addEventListener('ended', this.handleMediaEvent.bind(this));
      }

      this.sendUpdate();
      console.log('MediaAgent attached to element:', element);
    }

    detachFromElement() {
      if (this.mediaElement && !this.mediaElement.isVirtual) {
        // Remove event listeners for real elements
        this.mediaElement.removeEventListener('play', this.handleMediaEvent.bind(this));
        this.mediaElement.removeEventListener('pause', this.handleMediaEvent.bind(this));
        // ... other event listeners
      }
      
      this.mediaElement = null;
      if (this.updateThrottle) {
        clearTimeout(this.updateThrottle);
        this.updateThrottle = null;
      }
    }

    observeMediaElements() {
      const observer = new MutationObserver((mutations) => {
        let foundNewMedia = false;
        
        for (const mutation of mutations) {
          if (mutation.type === 'childList') {
            for (const node of mutation.addedNodes) {
              if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.matches('video, audio') || node.querySelector('video, audio')) {
                  foundNewMedia = true;
                  break;
                }
              }
            }
          }
        }

        if (foundNewMedia && !this.isVirtual) {
          setTimeout(() => this.findAndAttachMedia(), 100);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    }

    handleMediaEvent() {
      if (!this.isVirtual) {
        this.sendUpdate();
      }
    }

    handleTimeUpdate() {
      if (this.updateThrottle || this.isVirtual) return;

      this.updateThrottle = setTimeout(() => {
        this.sendUpdate();
        this.updateThrottle = null;
      }, 250);
    }

    sendUpdate() {
      if (!this.mediaElement) return;

      if (this._seekInProgress) {
        console.log('MediaAgent: Skipping generic sendUpdate while seek in progress');
        return;
      }

      if (this.isVirtual) {
        this.sendSpotifyUpdate();
        return;
      }

      const element = this.mediaElement;
      const state = {
        paused: element.paused,
        muted: element.muted,
        volume: element.volume,
        currentTime: element.currentTime || 0,
        duration: element.duration || 0,
        canSeek: element.seekable && element.seekable.length > 0,
        ended: element.ended
      };

      let title = document.title;
      let artworkUrl = null;

      if (navigator.mediaSession && navigator.mediaSession.metadata) {
        const metadata = navigator.mediaSession.metadata;
        title = metadata.title || title;
        if (metadata.artwork && metadata.artwork.length > 0) {
          artworkUrl = metadata.artwork[0].src;
        }
      }

      const sessionData = { title, artworkUrl, state };

      browserAPI.runtime.sendMessage({
        type: 'SESSION_UPDATE',
        data: sessionData
      }).catch(error => {
        console.error('Error sending session update:', error);
      });
    }

    handleControlCommand(cmd, params = {}) {
      console.log('MediaAgent: handleControlCommand called:', cmd, params, 'mediaElement present:', !!this.mediaElement, 'isVirtual:', this.mediaElement?.isVirtual);
      if (!this.mediaElement) {
        console.warn('No media element for control command:', cmd);
        return;
      }

      const element = this.mediaElement;

      try {
        switch (cmd) {
          case 'toggle':
            if (element.isVirtual) {
              if (element.paused) {
                element.play();
              } else {
                element.pause();
              }
            } else {
              if (element.paused) {
                element.play().catch(error => console.error('Play failed:', error));
              } else {
                element.pause();
              }
            }
            break;

          case 'seek':
            if (!element.isVirtual && element.seekable && element.seekable.length > 0) {
              try {
                const delta = params.delta || 0;
                const target = Math.max(0, Math.min(element.duration || Infinity, element.currentTime + delta));
                console.log('MediaAgent: seek delta', delta, 'target time', target);

                if (typeof element.fastSeek === 'function') {
                  try { element.fastSeek(target); } catch (e) { element.currentTime = target; }
                } else {
                  element.currentTime = target;
                }

                // Wait for seeked event (with fallback timeout)
                (function waitForSeek(el, callback) {
                  let done = false;
                  const onSeeked = () => { if (!done) { done = true; el.removeEventListener('seeked', onSeeked); callback(); } };
                  el.addEventListener('seeked', onSeeked);
                  setTimeout(() => { if (!done) { done = true; el.removeEventListener('seeked', onSeeked); callback(); } }, 1200);
                })(element, () => {
                  try { this.sendUpdate(); } catch (e) { console.warn('sendUpdate after seek failed', e); }
                });
              } catch (err) {
                console.error('MediaAgent: seek handling failed', err);
              }
            }
            break;

          case 'setTime':
            if (!element.isVirtual && element.seekable && element.seekable.length > 0 && params.time !== undefined) {
              try {
                const target = Math.max(0, Math.min(element.duration || Infinity, params.time));
                console.log('MediaAgent: setTime target', target);

                if (typeof element.fastSeek === 'function') {
                  try { element.fastSeek(target); } catch (e) { element.currentTime = target; }
                } else {
                  element.currentTime = target;
                }

                (function waitForSeek(el, callback) {
                  let done = false;
                  const onSeeked = () => { if (!done) { done = true; el.removeEventListener('seeked', onSeeked); callback(); } };
                  el.addEventListener('seeked', onSeeked);
                  setTimeout(() => { if (!done) { done = true; el.removeEventListener('seeked', onSeeked); callback(); } }, 1200);
                })(element, () => {
                  try { this.sendUpdate(); } catch(e) { console.warn('sendUpdate after setTime failed', e); }
                });
              } catch (err) {
                console.error('MediaAgent: setTime handling failed', err);
              }
            } else if (element.isVirtual && params.time !== undefined) {
              // Handle Spotify seeking
              this.spotifySeek(params.time);
            }
            break;

            case 'previousTrack':
              // Try site-specific previous track controls
              if (element.isVirtual) {
                this.spotifyAction('previous');
              } else {
                // Generic selectors for previous
                const prevSel = ['.player .previous', '.ytp-prev-button', '[aria-label*="Previous"]', '[data-testid*="previous"]'];
                for (const sel of prevSel) {
                  const btn = document.querySelector(sel);
                  if (btn) { try { btn.click(); break; } catch(e) { console.warn('prev click failed', e); } }
                }
              }
              break;

            case 'nextTrack':
              if (element.isVirtual) {
                this.spotifyAction('next');
              } else {
                const nextSel = ['.player .next', '.ytp-next-button', '[aria-label*="Next"]', '[data-testid*="next"]'];
                for (const sel of nextSel) {
                  const btn = document.querySelector(sel);
                  if (btn) { try { btn.click(); break; } catch(e) { console.warn('next click failed', e); } }
                }
              }
              break;

          case 'beginSeek':
            // Suppress updates during quick seek operations
            this._seekInProgress = true;
            console.log('MediaAgent: beginSeek - suppressing updates');
            break;

          case 'endSeek':
            // End suppression and trigger an immediate update
            this._seekInProgress = false;
            console.log('MediaAgent: endSeek - resuming updates, sending update now');
            try { this.sendUpdate(); } catch(e) { console.warn('sendUpdate failed after endSeek', e); }
            break;
            break;

          case 'setVolume':
            if (!element.isVirtual && params.volume !== undefined) {
              element.volume = Math.max(0, Math.min(1, params.volume));
            } else if (element.isVirtual && params.volume !== undefined) {
              // Handle Spotify volume
              this.spotifySetVolume(params.volume);
            }
            break;

          case 'mute':
            if (!element.isVirtual) {
              if (params.muted !== undefined) {
                element.muted = params.muted;
              } else {
                element.muted = !element.muted;
              }
            } else if (element.isVirtual) {
              // Handle Spotify mute
              if (params.muted !== undefined) {
                this.spotifySetMute(params.muted);
              } else {
                this.spotifySetMute(!element._muted);
              }
            }
            break;

          default:
            console.warn('Unknown control command:', cmd);
        }
      } catch (error) {
        console.error('Error executing control command:', cmd, error);
      }
    }
  }

  // Initialize agent when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      new MediaAgent();
    });
  } else {
    new MediaAgent();
  }

})();
