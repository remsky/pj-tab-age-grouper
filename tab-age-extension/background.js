// Settings with defaults
let settings = {
  warnMins: 5,
  deadMins: 30
};

// Extension paused state
let isPaused = false;

// Group Names and Colors
const GROUPS = {
  WARN: { title: "Stale 🟡", color: "yellow" },
  DEAD: { title: "Dead 🔴", color: "red" }
};

// Load settings on startup
chrome.storage.sync.get(['warnMins', 'deadMins', 'extensionPaused'], (items) => {
  if (items.warnMins) settings.warnMins = items.warnMins;
  if (items.deadMins) settings.deadMins = items.deadMins;
  if (items.extensionPaused !== undefined) isPaused = items.extensionPaused;
});

// Listen for settings changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    if (changes.warnMins) settings.warnMins = changes.warnMins.newValue;
    if (changes.deadMins) settings.deadMins = changes.deadMins.newValue;
    if (changes.extensionPaused !== undefined) isPaused = changes.extensionPaused.newValue;
    organizeTabs();
  }
});

// Run check every 1 minute
chrome.alarms.create("organizeTabs", { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "organizeTabs") organizeTabs();
});

// Also run immediately when extension loads/reloads
chrome.runtime.onStartup.addListener(async () => {
  await cleanupDuplicateGroups();
  organizeTabs();
});
chrome.runtime.onInstalled.addListener(async () => {
  await cleanupDuplicateGroups();
  organizeTabs();
});

// Merge duplicate groups (same title in same window)
async function cleanupDuplicateGroups() {
  const windows = await chrome.windows.getAll();

  for (const win of windows) {
    for (const groupConfig of [GROUPS.WARN, GROUPS.DEAD]) {
      const groups = await chrome.tabGroups.query({
        windowId: win.id,
        title: groupConfig.title
      });

      if (groups.length > 1) {
        // Keep the first group, move all tabs from others into it
        const keepGroup = groups[0];
        for (let i = 1; i < groups.length; i++) {
          const tabs = await chrome.tabs.query({ groupId: groups[i].id });
          if (tabs.length > 0) {
            const tabIds = tabs.map(t => t.id);
            await chrome.tabs.group({ groupId: keepGroup.id, tabIds });
          }
        }
      }
    }
  }
}

// Track when tabs become active (for immediate response)
chrome.tabs.onActivated.addListener(() => {
  setTimeout(organizeTabs, 100);
});

async function organizeTabs() {
  // Skip organizing if extension is paused
  if (isPaused) return;

  const tabs = await chrome.tabs.query({});
  const now = Date.now();

  // Cache group IDs per window to avoid race conditions
  // Key: "windowId:title" -> groupId
  const groupCache = new Map();

  for (const tab of tabs) {
    if (tab.pinned) continue;

    const lastAccessed = tab.active ? now : (tab.lastAccessed || now);
    const ageMinutes = (now - lastAccessed) / 1000 / 60;

    let targetGroup = null;

    if (ageMinutes >= settings.deadMins) {
      targetGroup = GROUPS.DEAD;
    } else if (ageMinutes >= settings.warnMins) {
      targetGroup = GROUPS.WARN;
    }

    if (targetGroup) {
      await addToGroup(tab, targetGroup, groupCache);
    } else {
      await removeFromOurGroups(tab);
    }
  }

  // Reorder groups: Dead first, then Stale (leftmost)
  await reorderGroups();
}

// Position groups: Dead -> Stale -> (fresh tabs)
async function reorderGroups() {
  const windows = await chrome.windows.getAll();

  for (const win of windows) {
    // Move to index 0 in reverse order (last moved = leftmost)
    // So move Stale first, then Dead pushes it right
    for (const groupConfig of [GROUPS.WARN, GROUPS.DEAD]) {
      const groups = await chrome.tabGroups.query({
        windowId: win.id,
        title: groupConfig.title
      });

      if (groups.length > 0) {
        try {
          await chrome.tabGroups.move(groups[0].id, { index: 0 });
        } catch (e) {}
      }
    }
  }
}

async function addToGroup(tab, groupConfig, groupCache) {
  // Check if tab is already in the correct group
  if (tab.groupId !== -1) {
    try {
      const currentGroup = await chrome.tabGroups.get(tab.groupId);
      if (currentGroup.title === groupConfig.title) return;
    } catch (e) {}
  }

  const cacheKey = `${tab.windowId}:${groupConfig.title}`;
  let groupId = groupCache.get(cacheKey);

  // If not in cache, query Chrome for existing group
  if (!groupId) {
    const existingGroups = await chrome.tabGroups.query({
      windowId: tab.windowId,
      title: groupConfig.title
    });

    if (existingGroups.length > 0) {
      groupId = existingGroups[0].id;
      groupCache.set(cacheKey, groupId);
    }
  }

  // Add to existing group or create new one
  if (groupId) {
    try {
      await chrome.tabs.group({ groupId: groupId, tabIds: tab.id });
    } catch (e) {
      // Group may have been deleted, remove from cache and retry
      groupCache.delete(cacheKey);
      groupId = null;
    }
  }

  if (!groupId) {
    groupId = await chrome.tabs.group({ createProperties: { windowId: tab.windowId }, tabIds: tab.id });
    await chrome.tabGroups.update(groupId, {
      color: groupConfig.color,
      title: groupConfig.title,
      collapsed: false
    });
    groupCache.set(cacheKey, groupId);
  }
}

async function removeFromOurGroups(tab) {
  if (tab.groupId === -1) return;

  try {
    const group = await chrome.tabGroups.get(tab.groupId);
    if (group.title === GROUPS.WARN.title || group.title === GROUPS.DEAD.title) {
      await chrome.tabs.ungroup(tab.id);
      // Move tab to the right (after groups) so live tabs stay on the right side
      await chrome.tabs.move(tab.id, { index: -1 });
    }
  } catch (e) {}
}
