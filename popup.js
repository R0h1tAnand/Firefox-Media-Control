// Popup script for Global Media Controller
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

class MediaControllerPopup {
  constructor() {
    this.sessions = new Map();
    this.port = null;
    this.allWindowsMode = false;
    // Optimistic state tracking
    this.optimisticStates = new Map(); // sessionId -> { paused: boolean, timestamp: number }

    this.init();
  }

  async init() {
    this.sessionsList = document.getElementById('sessionsList');
    this.emptyState = document.getElementById('emptyState');
    this.allWindowsToggle = document.getElementById('allWindowsToggle');

    if (this.allWindowsToggle) {
      this.allWindowsToggle.addEventListener('change', (e) => {
        this.allWindowsMode = e.target.checked;
        this.updateDisplay();
      });
    }

    this.connectToBackground();
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

      if (response && response.sessions) {
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
        // If we have a recent optimistic update (within 500ms), ignore the background state for paused
        // to prevent flickering if the background is slightly delayed
        const optState = this.optimisticStates.get(message.session.id);
        if (optState && (Date.now() - optState.timestamp < 1000)) {
          // Keep our optimistic pause state, but update everything else (time, volume, etc)
          message.session.state.paused = optState.paused;
        } else {
          // Clear old optimistic state
          this.optimisticStates.delete(message.session.id);
        }

        this.sessions.set(message.session.id, message.session);
        this.updateSessionCard(message.session);
        this.updateDisplay();
        break;

      case 'SESSION_REMOVED':
        this.sessions.delete(message.sessionId);
        this.optimisticStates.delete(message.sessionId);
        this.removeSessionCard(message.sessionId);
        this.updateDisplay();
        break;
    }
  }

  updateDisplay() {
    const sessionsToShow = Array.from(this.sessions.values());

    if (sessionsToShow.length === 0) {
      if (this.sessionsList) this.sessionsList.classList.add('hidden');
      if (this.emptyState) this.emptyState.classList.remove('hidden');
    } else {
      if (this.sessionsList) this.sessionsList.classList.remove('hidden');
      if (this.emptyState) this.emptyState.classList.add('hidden');
      this.renderSessions(sessionsToShow);
    }
  }

  renderSessions(sessions) {
    // Basic diffing to avoid full re-render
    // For now, if count matches, we blindly update. If not, re-render all.
    // Optimization: Just check if IDs exist.
    const container = this.sessionsList;
    const existingIds = new Set(Array.from(container.children).map(c => c.dataset.sessionId));
    const newIds = new Set(sessions.map(s => s.id));

    // Remove old
    for (const child of Array.from(container.children)) {
      if (!newIds.has(child.dataset.sessionId)) {
        child.remove();
      }
    }

    // Sort: playing sessions first, then by lastActiveAt
    sessions.sort((a, b) => {
      const aPlaying = a.state && !a.state.paused ? 1 : 0;
      const bPlaying = b.state && !b.state.paused ? 1 : 0;
      if (bPlaying !== aPlaying) return bPlaying - aPlaying;
      return b.lastActiveAt - a.lastActiveAt;
    });

    // Add/Moved
    for (const session of sessions) {
      let card = container.querySelector(`[data-session-id="${session.id}"]`);
      if (!card) {
        card = this.createSessionCard(session);
        container.appendChild(card);
      } else {
        // Re-order if needed (appendChild moves it to end)
        // But complex re-ordering might be overkill, let's just append to maintain sort order
        container.appendChild(card);
        // Update content is handled by updateSessionCard called separately or here?
        // We should ensure content is fresh.
        // updateSessionCard is called by SESSION_UPDATED.
        // But initial render needs data.
        this.updateSessionCardDOM(card, session);
      }
    }
  }

  // Parse title into { title, artist } trying to be smart about " - " separators
  parseMetadata(title) {
    if (!title) return { title: 'Unknown Title', artist: 'Unknown Artist' };

    const separator = ' - ';
    const parts = title.split(separator);
    if (parts.length >= 2) {
      // Heuristic: Artist is usually first for some sites, Title first for others.
      // Spotify standard: "Title - Artist" usually in window title, but MediaSession API is better.
      // The extension sends `document.title` or a constructed string.
      // Let's assume the constructed string in mediaAgent is `${trackName} - ${artistName}`
      return { title: parts[0], artist: parts.slice(1).join(separator) };
    }
    return { title: title, artist: '' }; // No artist detected
  }

  createSessionCard(session) {
    const card = document.createElement('div');
    card.className = 'session-card';
    card.dataset.sessionId = session.id;

    // Initial structure
    card.innerHTML = `
      <div class="session-header">
        <div class="session-artwork">
            <img src="" alt="Album Art" loading="lazy">
        </div>
        <div class="session-info">
            <div class="session-site-row">
                <img class="session-site-icon" src="" alt="">
                <span class="session-site"></span>
            </div>
            <div class="session-title"></div>
            <div class="session-artist"></div>
        </div>
      </div>
      
      <div class="progress-info">
          <div class="progress-container">
            <div class="time-display current-time">0:00</div>
            <div class="progress-bar" data-action="seek-to">
              <div class="progress-fill"></div>
              <div class="progress-handle"></div>
            </div>
            <div class="time-display duration">0:00</div>
          </div>
      </div>

      <div class="session-controls">
         <button class="control-btn" data-action="previousTrack" title="Previous">
             <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
         </button>
         <button class="control-btn" data-action="seek-backward" title="-10s">
             <svg viewBox="0 0 24 24" width="18" height="18"><path d="M12.5 3C8.36 3 4.86 5.48 3.23 9H1l3.5 4 3.5-4H5.67C7.01 6.57 9.56 5 12.5 5c4.14 0 7.5 3.36 7.5 7.5S16.64 20 12.5 20c-3.27 0-6.05-2.1-7.07-5H3.29c1.12 4.22 5.02 7.5 9.71 7.5 5.52 0 10-4.48 10-10S18.02 3 12.5 3z"/><text x="12.5" y="14" font-size="6" font-weight="bold" fill="currentColor" text-anchor="middle">10</text></svg>
         </button>
         <button class="control-btn primary toggle-play-btn" data-action="toggle" title="Play/Pause">
             <!-- Icon injected dynamically -->
         </button>
         <button class="control-btn" data-action="seek-forward" title="+10s">
             <svg viewBox="0 0 24 24" width="18" height="18"><path d="M11.5 3c4.14 0 7.64 2.48 9.27 6H23l-3.5 4-3.5-4h2.33C16.99 6.57 14.44 5 11.5 5 7.36 5 4 8.36 4 12.5S7.36 20 11.5 20c3.27 0 6.05-2.1 7.07-5h2.14c-1.12 4.22-5.02 7.5-9.71 7.5-5.52 0-10-4.48-10-10S5.98 3 11.5 3z"/><text x="11.5" y="14" font-size="6" font-weight="bold" fill="currentColor" text-anchor="middle">10</text></svg>
         </button>
         <button class="control-btn" data-action="nextTrack" title="Next">
             <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
         </button>
      </div>

      <div class="session-footer">
          <div class="volume-control">
             <span class="volume-icon" data-action="mute">🔊</span>
             <input type="range" class="volume-slider" min="0" max="1" step="0.01">
          </div>
          <button class="control-btn open-tab-btn" data-action="open-tab" title="Open Tab">
             <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
          </button>
      </div>
    `;

    this.addCardEventListeners(card, session);
    this.updateSessionCardDOM(card, session);
    // Init progress bar logic
    this.addProgressBarDragSupport(card.querySelector('.progress-bar'), session);

    return card;
  }

  updateSessionCard(session) {
    const card = this.sessionsList.querySelector(`[data-session-id="${session.id}"]`);
    if (card) {
      this.updateSessionCardDOM(card, session);
    }
  }

  updateSessionCardDOM(card, session) {
    // Logic to update DOM elements efficiently
    const { title, artist } = this.parseMetadata(session.title);

    const titleEl = card.querySelector('.session-title');
    if (titleEl.textContent !== title) titleEl.textContent = title;

    const artistEl = card.querySelector('.session-artist');
    if (artistEl.textContent !== artist) artistEl.textContent = artist;

    const siteEl = card.querySelector('.session-site');
    const siteName = this.getSiteName(session.url);
    if (siteEl.textContent !== siteName) siteEl.textContent = siteName;

    // Icon
    const iconEl = card.querySelector('.session-site-icon');
    if (session.favIconUrl) iconEl.src = session.favIconUrl;
    else iconEl.style.display = 'none';

    // Artwork
    const artImg = card.querySelector('.session-artwork img');
    const artContainer = card.querySelector('.session-artwork');
    if (session.artworkUrl) {
      if (artImg.src !== session.artworkUrl) artImg.src = session.artworkUrl;
      artImg.style.display = 'block';
      // Use SVG fallback if error?
    } else {
      // Fallback if no artwork
      if (session.favIconUrl) {
        if (artImg.src !== session.favIconUrl) artImg.src = session.favIconUrl;
        artImg.style.display = 'block';
      } else {
        artImg.style.display = 'none';
        // Maybe insert a generic icon
      }
    }

    // Play/Pause Button
    const playBtn = card.querySelector('.toggle-play-btn');
    const isPaused = session.state.paused;
    const playIcon = `<svg viewBox="0 0 24 24" width="20" height="20"><path d="M8 5v14l11-7z"/></svg>`;
    const pauseIcon = `<svg viewBox="0 0 24 24" width="20" height="20"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;

    // Only update HTML if it changed to prevent flicker
    const targetIcon = isPaused ? playIcon : pauseIcon;
    if (playBtn.innerHTML !== targetIcon) playBtn.innerHTML = targetIcon;
    playBtn.title = isPaused ? 'Play' : 'Pause';

    // Volume
    const volSlide = card.querySelector('.volume-slider');
    // Only update slider if user is NOT dragging it (check active element)
    if (document.activeElement !== volSlide) {
      volSlide.value = session.state.volume;
      // Visual fill for slider (webkit hack usually needed, but here we just set value)
    }

    const muteIcon = card.querySelector('.volume-icon');
    muteIcon.textContent = session.state.muted ? '🔇' : '🔊';

    // Progress (only if not dragging)
    const progressBar = card.querySelector('.progress-bar');
    if (!progressBar.classList.contains('dragging')) {
      this.updateProgressBarVisuals(card, session.state);
    }
  }

  updateProgressBarVisuals(card, state) {
    const progressFill = card.querySelector('.progress-fill');
    const progressHandle = card.querySelector('.progress-handle');
    const currentEl = card.querySelector('.current-time');
    const durationEl = card.querySelector('.duration');

    if (!state.duration) {
      progressFill.style.width = '0%';
      progressHandle.style.left = '0%';
      return;
    }

    const pct = (state.currentTime / state.duration) * 100;
    progressFill.style.width = `${pct}%`;
    progressHandle.style.left = `${pct}%`;

    currentEl.textContent = this.formatTime(state.currentTime);
    durationEl.textContent = this.formatTime(state.duration);
  }

  addCardEventListeners(card, session) {
    // Delegated clicks for controls
    card.addEventListener('click', (e) => {
      const btn = e.target.closest('.control-btn, .volume-icon');
      if (!btn) return;

      const action = btn.dataset.action;
      if (!action) return;

      e.stopPropagation();

      if (action === 'toggle') {
        this.handleToggle(session, btn);
      } else if (action === 'mute') {
        this.sendControlCommand(session.id, 'mute');
      } else if (action === 'open-tab') {
        this.openTab(session.id);
      } else if (action === 'seek-forward') {
        this.sendControlCommand(session.id, 'seek', { delta: 10 });
      } else if (action === 'seek-backward') {
        this.sendControlCommand(session.id, 'seek', { delta: -10 });
      } else if (action === 'nextTrack') {
        this.sendControlCommand(session.id, 'nextTrack');
      } else if (action === 'previousTrack') {
        this.sendControlCommand(session.id, 'previousTrack');
      }
    });

    const volumeSlider = card.querySelector('.volume-slider');
    volumeSlider.addEventListener('input', (e) => {
      const vol = parseFloat(e.target.value);
      this.sendControlCommand(session.id, 'setVolume', { volume: vol });
    });
  }

  handleToggle(session, btn) {
    // OPTIMISTIC UPDATE
    const newPausedState = !session.state.paused;
    session.state.paused = newPausedState;

    // Update our Optimistic map to ignore incoming stale messages for a bit
    this.optimisticStates.set(session.id, {
      paused: newPausedState,
      timestamp: Date.now()
    });

    // Force UI update immediately
    this.updateSessionCardDOM(btn.closest('.session-card'), session);

    // Send actual command
    this.sendControlCommand(session.id, 'toggle');
  }

  addProgressBarDragSupport(progressBar, session) {
    let isDragging = false;

    // Mouse events
    const startDrag = (e) => {
      if (!session.state.duration) return;
      isDragging = true;
      progressBar.classList.add('dragging');
      this.sendControlCommand(session.id, 'beginSeek'); // Pause updates

      const onMove = (moveEvent) => {
        const rect = progressBar.getBoundingClientRect();
        const clientX = moveEvent.clientX || (moveEvent.touches && moveEvent.touches[0].clientX);
        const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
        const pct = x / rect.width;

        // Update visuals locally
        const card = progressBar.closest('.session-card');
        const progressFill = card.querySelector('.progress-fill');
        const progressHandle = card.querySelector('.progress-handle');
        const timeDisplay = card.querySelector('.current-time');

        progressFill.style.width = `${pct * 100}%`;
        progressHandle.style.left = `${pct * 100}%`;

        const time = pct * session.state.duration;
        timeDisplay.textContent = this.formatTime(time);
      };

      const onEnd = (endEvent) => {
        isDragging = false;
        progressBar.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onEnd);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onEnd);

        // Calculate final time and send
        const rect = progressBar.getBoundingClientRect();
        // use last known position if needed, but for mouseup we can use clientX usually
        // For simple logic, let's just use the visual % we left it at? 
        // Better to recalc from event if possible, but let's stick to the visual fill width as truth
        const card = progressBar.closest('.session-card');
        const fill = card.querySelector('.progress-fill');
        const pct = parseFloat(fill.style.width) / 100;
        const finalTime = pct * session.state.duration;

        this.sendControlCommand(session.id, 'setTime', { time: finalTime });
        this.sendControlCommand(session.id, 'endSeek');
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onEnd);
      document.addEventListener('touchmove', onMove);
      document.addEventListener('touchend', onEnd);

      onMove(e); // Init
    };

    progressBar.addEventListener('mousedown', startDrag);
    progressBar.addEventListener('touchstart', startDrag);
  }

  sendControlCommand(sessionId, cmd, params = {}) {
    if (this.port) {
      this.port.postMessage({
        type: 'CONTROL_COMMAND',
        data: { sessionId, cmd, ...params }
      });
    }
  }

  async openTab(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      try {
        // Focus the tab
        await browserAPI.tabs.update(session.tabId, { active: true });

        // Focus the window containing the tab
        const tab = await browserAPI.tabs.get(session.tabId);
        if (tab && tab.windowId) {
          await browserAPI.windows.update(tab.windowId, { focused: true });
        }
        window.close();
      } catch (e) {
        console.error('Error opening tab:', e);
      }
    }
  }

  getSiteName(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace(/^www\./, '');
    } catch {
      return 'Unknown site';
    }
  }

  formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new MediaControllerPopup();
});
