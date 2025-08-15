// Popup script for Global Media Controller
// Use browser API (Firefox) or chrome API (Chrome) for cross-compatibility
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

class MediaControllerPopup {
  constructor() {
    this.sessions = new Map();
    this.port = null;
    this.allWindowsMode = false;
    
    this.init();
  }

  async init() {
    // Get DOM elements
    this.sessionsList = document.getElementById('sessionsList');
    this.emptyState = document.getElementById('emptyState');
    this.allWindowsToggle = document.getElementById('allWindowsToggle');

    // Set up event listeners
    this.allWindowsToggle.addEventListener('change', (e) => {
      this.allWindowsMode = e.target.checked;
      this.updateDisplay();
    });

    // Connect to background script
    this.connectToBackground();

    // Load initial state
    await this.loadSessions();
  }

  connectToBackground() {
    this.port = browserAPI.runtime.connect({ name: 'popup' });
    
    this.port.onMessage.addListener((message) => {
      this.handleBackgroundMessage(message);
    });

    this.port.onDisconnect.addListener(() => {
      console.log('Disconnected from background script');
    });
  }

  async loadSessions() {
    try {
      const response = await browserAPI.runtime.sendMessage({
        type: 'GET_SESSIONS'
      });
      
      if (response.sessions) {
        this.sessions.clear();
        for (const session of response.sessions) {
          this.sessions.set(session.id, session);
        }
        this.updateDisplay();
      }
    } catch (error) {
      console.error('Error loading sessions:', error);
    }
  }

  handleBackgroundMessage(message) {
    switch (message.type) {
      case 'SESSIONS_INIT':
        this.sessions.clear();
        for (const session of message.sessions) {
          this.sessions.set(session.id, session);
        }
        this.updateDisplay();
        break;

      case 'SESSION_UPDATED':
        this.sessions.set(message.session.id, message.session);
        this.updateSessionCard(message.session);
        this.updateDisplay();
        break;

      case 'SESSION_REMOVED':
        this.sessions.delete(message.sessionId);
        this.removeSessionCard(message.sessionId);
        this.updateDisplay();
        break;
    }
  }

  updateDisplay() {
    const sessionsToShow = this.getFilteredSessions();
    
    if (sessionsToShow.length === 0) {
      this.sessionsList.classList.add('hidden');
      this.emptyState.classList.remove('hidden');
    } else {
      this.sessionsList.classList.remove('hidden');
      this.emptyState.classList.add('hidden');
      
      // Update existing cards and add new ones
      this.renderSessions(sessionsToShow);
    }
  }

  getFilteredSessions() {
    // For now, show all sessions (all windows mode not fully implemented)
    return Array.from(this.sessions.values());
  }

  renderSessions(sessions) {
    // Clear existing cards
    this.sessionsList.innerHTML = '';
    
    // Sort sessions by last active time
    sessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    
    for (const session of sessions) {
      const card = this.createSessionCard(session);
      this.sessionsList.appendChild(card);
    }
  }

  createSessionCard(session) {
    const card = document.createElement('div');
    card.className = 'session-card';
    card.dataset.sessionId = session.id;
    
    if (session.state.paused) {
      card.classList.add('paused');
    }
    
    if (session.state.muted) {
      card.classList.add('muted');
    }

    // Get site name from URL
    const siteName = this.getSiteName(session.url);
    
    card.innerHTML = `
      <div class="session-header">
        <div class="session-artwork">
          ${session.artworkUrl ? 
            `<img src="${session.artworkUrl}" alt="Artwork">` : 
            `<div class="session-artwork-fallback">${session.favIconUrl ? 
              `<img src="${session.favIconUrl}" alt="Site icon">` : 
              '🎵'
            }</div>`
          }
        </div>
        <div class="session-info">
          <div class="session-title" title="${session.title}">${session.title}</div>
          <div class="session-site" title="${siteName}">${siteName}</div>
        </div>
      </div>
      
      <div class="session-controls">
        <button class="control-btn" data-action="previousTrack" title="Previous Track" aria-label="Previous Track">
          <!-- Backward step icon -->
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
            <rect x="2" y="4" width="3" height="16" rx="1" />
            <path d="M9 12L20 19V5L9 12Z" />
          </svg>
        </button>
        <button class="control-btn seek-btn" data-action="seek-backward" title="Seek -10s" aria-label="Rewind 10 seconds">
          <!-- MdOutlineReplay10-like icon (back 10) -->
          <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" fill="currentColor">
            <path d="M11.99 5V1l-5 5 5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6h-2c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
            <text x="12" y="15" font-size="7" font-weight="bold" fill="currentColor" text-anchor="middle">10</text>
          </svg>
        </button>
        <button class="control-btn primary" data-action="toggle" title="${session.state.paused ? 'Play' : 'Pause'}" aria-label="Play or Pause">
          ${session.state.paused ? `
            <!-- Play icon (FaPlay-like) -->
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
              <path d="M6 4v16l12-8L6 4z" />
            </svg>
          ` : `
            <!-- Pause icon (FaPause-like) -->
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          `}
        </button>
        <button class="control-btn seek-btn" data-action="seek-forward" title="Seek +10s" aria-label="Forward 10 seconds">
          <!-- MdForward10-like icon (forward 10) -->
          <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" fill="currentColor">
            <path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z"/>
            <text x="12" y="15" font-size="7" font-weight="bold" fill="currentColor" text-anchor="middle">10</text>
          </svg>
        </button>
        <button class="control-btn" data-action="nextTrack" title="Next Track" aria-label="Next Track">
          <!-- Forward step icon -->
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
            <path d="M4 5v14l11-7L4 5z" />
            <rect x="18" y="4" width="3" height="16" rx="1" />
          </svg>
        </button>
      </div>
      
      <div class="progress-container">
        <span class="time-display">${this.formatTime(session.state.currentTime)}</span>
        <div class="progress-bar" data-action="seek-to">
          <div class="progress-fill"></div>
          <div class="progress-handle"></div>
        </div>
        <span class="time-display">${this.formatTime(session.state.duration)}</span>
      </div>
      
      <div class="session-footer">
        <div class="volume-control">
          <button class="control-btn" data-action="mute" title="${session.state.muted ? 'Unmute' : 'Mute'}">
            ${session.state.muted ? '🔇' : '🔊'}
          </button>
          <input type="range" class="volume-slider" min="0" max="1" step="0.01" 
                 value="${session.state.volume}" data-action="volume">
        </div>
        <button class="control-btn open-tab-btn" data-action="open-tab" title="Open tab">
          🔗
        </button>
      </div>
    `;

    // Add event listeners
    this.addCardEventListeners(card, session);
    
    // Update progress bar
    this.updateProgressBar(card, session.state);
    
    return card;
  }

  addCardEventListeners(card, session) {
    // Control buttons
    card.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      if (!action) return;
      
      e.preventDefault();
      e.stopPropagation();
      
      this.handleAction(session.id, action, e);
    });

    // Progress bar seeking
    const progressBar = card.querySelector('.progress-bar');
    progressBar.addEventListener('click', (e) => {
      this.handleProgressBarClick(session.id, session.state, e);
    });

    // Add drag support for progress bar
    this.addProgressBarDragSupport(progressBar, session);

    // Volume slider
    const volumeSlider = card.querySelector('.volume-slider');
    volumeSlider.addEventListener('input', (e) => {
      this.sendControlCommand(session.id, 'setVolume', { volume: parseFloat(e.target.value) });
    });
  }

  handleAction(sessionId, action, event) {
    switch (action) {
      case 'toggle':
        this.sendControlCommand(sessionId, 'toggle');
        break;
        
      case 'seek-backward':
        this.sendControlCommand(sessionId, 'seek', { delta: -10 });
        break;
        
      case 'seek-forward':
        this.sendControlCommand(sessionId, 'seek', { delta: 10 });
        break;

      case 'previousTrack':
        this.sendControlCommand(sessionId, 'previousTrack');
        break;

      case 'nextTrack':
        this.sendControlCommand(sessionId, 'nextTrack');
        break;
        
      case 'mute':
        this.sendControlCommand(sessionId, 'mute');
        break;
        
      case 'open-tab':
        this.openTab(sessionId);
        break;
    }
  }

  addProgressBarDragSupport(progressBar, session) {
    let isDragging = false;
    let wasPlaying = false;
    
    const startDrag = (e) => {
      if (!session.state.canSeek || !session.state.duration) return;
      
      isDragging = true;
      wasPlaying = !session.state.paused;
      
      // Add visual feedback
      progressBar.classList.add('dragging');
      
  // Notify content script that seek is beginning to suppress updates
  this.sendControlCommand(session.id, 'beginSeek');
      
      document.addEventListener('mousemove', onDrag);
      document.addEventListener('mouseup', endDrag);
      
      // Handle initial position
      onDrag(e);
      e.preventDefault();
    };
    
    const onDrag = (e) => {
      if (!isDragging) return;
      
      const rect = progressBar.getBoundingClientRect();
      const clickX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const percentage = clickX / rect.width;
      const newTime = percentage * session.state.duration;
      
      // Update UI immediately for responsive feedback
      const progressFill = progressBar.querySelector('.progress-fill');
      const progressHandle = progressBar.querySelector('.progress-handle');
      
      if (progressFill) {
        progressFill.style.width = `${percentage * 100}%`;
      }
      if (progressHandle) {
        progressHandle.style.left = `${percentage * 100}%`;
      }
      
      // Update time display
      const card = progressBar.closest('.session-card');
      const timeDisplays = card.querySelectorAll('.time-display');
      if (timeDisplays.length >= 1) {
        timeDisplays[0].textContent = this.formatTime(newTime);
      }
      
      e.preventDefault();
    };
    
    const endDrag = (e) => {
      if (!isDragging) return;
      
      isDragging = false;
      progressBar.classList.remove('dragging');
      
      document.removeEventListener('mousemove', onDrag);
      document.removeEventListener('mouseup', endDrag);
      
      // Calculate final position and seek
      const rect = progressBar.getBoundingClientRect();
      const clickX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const percentage = clickX / rect.width;
      const newTime = percentage * session.state.duration;
      
  // Send seek command and notify end of seek so content script can resume updates
  this.sendControlCommand(session.id, 'setTime', { time: newTime });
  this.sendControlCommand(session.id, 'endSeek');
      
      e.preventDefault();
    };
    
    // Mouse events
    progressBar.addEventListener('mousedown', startDrag);
    
    // Touch events for mobile support
    progressBar.addEventListener('touchstart', (e) => {
      const touch = e.touches[0];
      startDrag({
        clientX: touch.clientX,
        clientY: touch.clientY,
        preventDefault: () => e.preventDefault()
      });
    });
    
    progressBar.addEventListener('touchmove', (e) => {
      if (isDragging) {
        const touch = e.touches[0];
        onDrag({
          clientX: touch.clientX,
          clientY: touch.clientY,
          preventDefault: () => e.preventDefault()
        });
      }
    });
    
    progressBar.addEventListener('touchend', (e) => {
      if (isDragging) {
        const touch = e.changedTouches[0];
        endDrag({
          clientX: touch.clientX,
          clientY: touch.clientY,
          preventDefault: () => e.preventDefault()
        });
      }
    });
  }

  handleProgressBarClick(sessionId, state, event) {
    if (!state.canSeek || !state.duration) return;
    
    const progressBar = event.currentTarget;
    const rect = progressBar.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const percentage = clickX / rect.width;
    const newTime = percentage * state.duration;
    
    this.sendControlCommand(sessionId, 'setTime', { time: newTime });
  }

  sendControlCommand(sessionId, cmd, params = {}) {
    if (this.port) {
      this.port.postMessage({
        type: 'CONTROL_COMMAND',
        data: {
          sessionId,
          cmd,
          ...params
        }
      });
    }
  }

  async openTab(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    
    try {
      // Focus the tab
      await browserAPI.tabs.update(session.tabId, { active: true });
      
      // Focus the window containing the tab
      const tab = await browserAPI.tabs.get(session.tabId);
      await browserAPI.windows.update(tab.windowId, { focused: true });
      
      // Close popup
      window.close();
    } catch (error) {
      console.error('Error opening tab:', error);
    }
  }

  updateSessionCard(session) {
    const card = document.querySelector(`[data-session-id="${session.id}"]`);
    if (!card) return;
    
    // Update pause state
    card.classList.toggle('paused', session.state.paused);
    card.classList.toggle('muted', session.state.muted);
    
    // Update play/pause button
    const toggleBtn = card.querySelector('[data-action="toggle"]');
    if (toggleBtn) {
      // Replace contents with inline SVGs to match FaPlay / FaPause visuals
      toggleBtn.innerHTML = session.state.paused ?
        `<!-- Play icon -->
         <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
           <path d="M6 4v16l12-8L6 4z" />
         </svg>` :
        `<!-- Pause icon -->
         <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
           <rect x="6" y="5" width="4" height="14" rx="1" />
           <rect x="14" y="5" width="4" height="14" rx="1" />
         </svg>`;
      toggleBtn.title = session.state.paused ? 'Play' : 'Pause';
    }
    
    // Update mute button
    const muteBtn = card.querySelector('[data-action="mute"]');
    if (muteBtn) {
      muteBtn.innerHTML = session.state.muted ? '🔇' : '🔊';
      muteBtn.title = session.state.muted ? 'Unmute' : 'Mute';
    }
    
    // Update volume slider
    const volumeSlider = card.querySelector('.volume-slider');
    if (volumeSlider) {
      volumeSlider.value = session.state.volume;
    }
    
    // Update progress bar
    this.updateProgressBar(card, session.state);
    
    // Update time displays
    const timeDisplays = card.querySelectorAll('.time-display');
    if (timeDisplays.length >= 2) {
      timeDisplays[0].textContent = this.formatTime(session.state.currentTime);
      timeDisplays[1].textContent = this.formatTime(session.state.duration);
    }
  }

  updateProgressBar(card, state) {
    const progressFill = card.querySelector('.progress-fill');
    const progressHandle = card.querySelector('.progress-handle');
    
    if (!progressFill || !progressHandle || !state.duration) return;
    
    // Don't update progress bar if user is currently dragging it
    const progressBar = card.querySelector('.progress-bar');
    if (progressBar && progressBar.classList.contains('dragging')) {
      return;
    }
    
    const percentage = (state.currentTime / state.duration) * 100;
    progressFill.style.width = `${percentage}%`;
    progressHandle.style.left = `${percentage}%`;
  }

  removeSessionCard(sessionId) {
    const card = document.querySelector(`[data-session-id="${sessionId}"]`);
    if (card) {
      card.remove();
    }
  }

  getSiteName(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch {
      return 'Unknown site';
    }
  }

  formatTime(seconds) {
    if (!seconds || !isFinite(seconds)) return '0:00';
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }
}

// Initialize popup when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new MediaControllerPopup();
});

console.log('Media Controller popup script loaded');
