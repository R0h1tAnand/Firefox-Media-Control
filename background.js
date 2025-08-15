// Background script for Global Media Controller (Firefox compatible)

// Use browser API (Firefox) or chrome API (Chrome) for cross-compatibility
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

class MediaSessionManager {
  constructor() {
    this.sessions = new Map(); // sessionId -> session data
    this.ports = new Set(); // connected popup ports
    this.lastActiveSessionId = null;
  this.lastBroadcastTimestamps = new Map(); // sessionId -> timestamp
    
    this.init();
  }

  init() {
    // Listen for tab updates to detect audible tabs
    browserAPI.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      console.log('Tab updated:', tabId, 'changeInfo:', changeInfo);
      
      if (changeInfo.audible !== undefined) {
        this.handleTabAudibleChange(tab);
      }
      
      // Also check when page status changes to complete for music sites
      if (changeInfo.status === 'complete' && tab.url) {
        const isMusicSite = tab.url.includes('spotify.com') ||
                           tab.url.includes('youtube.com') ||
                           tab.url.includes('soundcloud.com') ||
                           tab.url.includes('music.youtube.com');
        
        if (isMusicSite) {
          console.log('Music site loaded, injecting agent:', tab.url);
          setTimeout(() => this.injectMediaAgent(tabId), 1000);
        }
      }
    });

    // Listen for tab removal
    browserAPI.tabs.onRemoved.addListener((tabId) => {
      this.removeSessionsForTab(tabId);
    });

    // Listen for commands (keyboard shortcuts)
    browserAPI.commands.onCommand.addListener((command) => {
      this.handleCommand(command);
    });

    // Listen for popup connections
    browserAPI.runtime.onConnect.addListener((port) => {
      if (port.name === 'popup') {
        this.handlePopupConnection(port);
      }
    });

    // Listen for messages from content scripts
    browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true; // Keep message channel open for async response
    });

    // Initial scan for audible tabs
    this.scanAudibleTabs();
    
    // Also scan for music sites that might not be audible yet
    this.scanMusicSites();
    
    // Periodic scan for missed audible tabs
    setInterval(() => {
      console.log('Periodic scan for audible tabs...');
      this.scanAudibleTabs();
    }, 5000);
  }

  async scanAudibleTabs() {
    try {
      const tabs = await browserAPI.tabs.query({ audible: true });
      for (const tab of tabs) {
        this.handleTabAudibleChange(tab);
      }
    } catch (error) {
      console.error('Error scanning audible tabs:', error);
    }
  }

  async scanMusicSites() {
    try {
      console.log('Scanning for music sites...');
      const allTabs = await browserAPI.tabs.query({});
      
      for (const tab of allTabs) {
        if (tab.url && (
          tab.url.includes('spotify.com') ||
          tab.url.includes('youtube.com') ||
          tab.url.includes('soundcloud.com') ||
          tab.url.includes('music.youtube.com')
        )) {
          console.log('Found music site tab:', tab.url);
          await this.injectMediaAgent(tab.id);
        }
      }
    } catch (error) {
      console.error('Error scanning music sites:', error);
    }
  }

  async handleTabAudibleChange(tab) {
    console.log('Tab audible change detected:', tab.id, 'audible:', tab.audible, 'url:', tab.url);
    
    if (tab.audible) {
      // Tab became audible, inject media agent if needed
      console.log('Injecting media agent into audible tab:', tab.id);
      await this.injectMediaAgent(tab.id);
    } else {
      // For music sites like Spotify, don't remove sessions immediately when paused
      // Only remove if the tab is actually closed or navigated away from music sites
      const isMusicSite = tab.url && (
        tab.url.includes('spotify.com') ||
        tab.url.includes('youtube.com') ||
        tab.url.includes('soundcloud.com') ||
        tab.url.includes('music.youtube.com')
      );
      
      if (!isMusicSite) {
        console.log('Removing sessions for non-audible, non-music tab:', tab.id);
        this.removeSessionsForTab(tab.id);
      } else {
        console.log('Keeping sessions for music site tab that became non-audible:', tab.id);
      }
    }
  }

  async injectMediaAgent(tabId) {
    try {
      console.log('Attempting to inject media agent into tab:', tabId);
      
      // Check if agent is already injected
      const results = await browserAPI.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => window.hasMediaAgent === true
      });

      const alreadyInjected = results.some(result => result.result === true);
      console.log('Agent already injected?', alreadyInjected);
      
      if (!alreadyInjected) {
        console.log('Injecting media agent script...');
        await browserAPI.scripting.executeScript({
          target: { tabId, allFrames: true },
          files: ['mediaAgent.js']
        });
        console.log('Media agent injected successfully');
      }
    } catch (error) {
      console.error(`Error injecting media agent into tab ${tabId}:`, error);
    }
  }

  handleMessage(message, sender, sendResponse) {
    const { type, data } = message;
    const tabId = sender.tab?.id;

    console.log('Background received message:', type, 'from tab:', tabId);

    switch (type) {
      case 'SESSION_UPDATE':
        console.log('Updating session:', data);
        this.updateSession(data, tabId, sender.frameId || 0);
        sendResponse({ success: true });
        break;

      case 'SESSION_REMOVE':
        this.removeSession(data.sessionId);
        sendResponse({ success: true });
        break;

      case 'CONTROL_COMMAND':
        this.forwardControlCommand(data);
        sendResponse({ success: true });
        break;

      case 'GET_SESSIONS':
        sendResponse({ sessions: Array.from(this.sessions.values()) });
        break;

      case 'GET_TAB_ID':
        sendResponse({ tabId: tabId });
        break;

      default:
        sendResponse({ error: 'Unknown message type' });
    }
  }

  updateSession(sessionData, tabId, frameId) {
    const sessionId = `${tabId}:${frameId}`;
    
    // Get tab info for the session
    browserAPI.tabs.get(tabId).then(tab => {
      const prev = this.sessions.get(sessionId);
      const now = Date.now();

      // Preserve lastActiveAt unless playback state changes to playing for the first time
      let lastActiveAt = prev ? prev.lastActiveAt : now;
      if (!prev) {
        // new session, set lastActiveAt to now
        lastActiveAt = now;
      }

      const session = {
        id: sessionId,
        tabId,
        frameId,
        title: sessionData.title || tab.title,
        url: tab.url,
        favIconUrl: tab.favIconUrl,
        artworkUrl: sessionData.artworkUrl,
        state: sessionData.state,
        lastActiveAt
      };

      // Decide whether to update lastActiveAt (only when session becomes playing)
      if (prev && prev.state && prev.state.paused && !session.state.paused) {
        session.lastActiveAt = now;
        this.lastActiveSessionId = sessionId;
      } else if (!prev && !session.state.paused) {
        // new and playing
        session.lastActiveAt = now;
        this.lastActiveSessionId = sessionId;
      }

      // Throttle frequent progress updates per session to reduce UI churn
      const lastBroadcast = this.lastBroadcastTimestamps.get(sessionId) || 0;
      const isStateChange = !prev || (prev.state && prev.state.paused !== session.state.paused);
      const throttleMs = 300; // minimum ms between broadcasts for progress-only updates
      const shouldBroadcast = isStateChange || (now - lastBroadcast) >= throttleMs || !prev;

      // Store session state regardless so background has latest
      this.sessions.set(sessionId, session);

      if (shouldBroadcast) {
        this.lastBroadcastTimestamps.set(sessionId, now);
        // Notify all connected popups
        this.broadcastToPopups({
          type: 'SESSION_UPDATED',
          session
        });
      }
    }).catch(error => {
      console.error('Error getting tab info:', error);
    });
  }

  removeSession(sessionId) {
    if (this.sessions.delete(sessionId)) {
      // Clear last active if it was this session
      if (this.lastActiveSessionId === sessionId) {
        this.lastActiveSessionId = this.findMostRecentActiveSession();
      }

      this.broadcastToPopups({
        type: 'SESSION_REMOVED',
        sessionId
      });
    }
  }

  removeSessionsForTab(tabId) {
    const toRemove = [];
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.tabId === tabId) {
        toRemove.push(sessionId);
      }
    }

    for (const sessionId of toRemove) {
      this.removeSession(sessionId);
    }
  }

  findMostRecentActiveSession() {
    let mostRecent = null;
    let mostRecentTime = 0;

    for (const session of this.sessions.values()) {
      if (session.lastActiveAt > mostRecentTime) {
        mostRecentTime = session.lastActiveAt;
        mostRecent = session.id;
      }
    }

    return mostRecent;
  }

  async forwardControlCommand(command) {
    const { sessionId, cmd, ...params } = command;
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      console.error('Session not found:', sessionId);
      return;
    }

    try {
      await browserAPI.tabs.sendMessage(session.tabId, {
        type: 'MEDIA_CONTROL',
        frameId: session.frameId,
        cmd,
        params
      });
    } catch (error) {
      console.error('Error forwarding control command:', error);
      // Remove session if tab is no longer responsive
      this.removeSession(sessionId);
    }
  }

  handleCommand(command) {
    const session = this.lastActiveSessionId ? this.sessions.get(this.lastActiveSessionId) : null;
    
    if (!session) {
      console.log('No active session for command:', command);
      return;
    }

    switch (command) {
      case 'toggle-play':
        this.forwardControlCommand({
          sessionId: this.lastActiveSessionId,
          cmd: 'toggle'
        });
        break;

      case 'seek-forward':
        this.forwardControlCommand({
          sessionId: this.lastActiveSessionId,
          cmd: 'seek',
          delta: 10
        });
        break;

      case 'seek-backward':
        this.forwardControlCommand({
          sessionId: this.lastActiveSessionId,
          cmd: 'seek',
          delta: -10
        });
        break;
    }
  }

  handlePopupConnection(port) {
    this.ports.add(port);

    // Send current sessions to the new popup
    port.postMessage({
      type: 'SESSIONS_INIT',
      sessions: Array.from(this.sessions.values())
    });

    // Handle popup messages
    port.onMessage.addListener((message) => {
      if (message.type === 'CONTROL_COMMAND') {
        this.forwardControlCommand(message.data);
      }
    });

    // Clean up when popup disconnects
    port.onDisconnect.addListener(() => {
      this.ports.delete(port);
    });
  }

  broadcastToPopups(message) {
    for (const port of this.ports) {
      try {
        port.postMessage(message);
      } catch (error) {
        // Port is disconnected, remove it
        this.ports.delete(port);
      }
    }
  }
}

// Initialize the session manager
const sessionManager = new MediaSessionManager();

console.log('Global Media Controller background script loaded');
