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
chrome.runtime.onStartup.addListener(scheduleStartupCleanup);
chrome.runtime.onInstalled.addListener(scheduleStartupCleanup);

// Chrome restores the previous session's windows and tabs asynchronously after
// launch, typically AFTER onStartup fires. A single cleanup pass therefore runs
// against a half-restored set of windows and misses the Stale/Dead groups that
// restore brings back a moment later - which is how duplicates accumulated
// across every browser restart. Run several staggered passes so duplicates get
// merged as the session finishes restoring.
function scheduleStartupCleanup() {
  for (const delay of [0, 1000, 3000, 8000, 15000]) {
    setTimeout(() => { cleanupNow(); }, delay);
  }
}

// Each restored window arrives as an onCreated event during session restore;
// re-running here merges any duplicates immediately instead of waiting for the
// next alarm. The re-entrancy guard coalesces the burst of restore events.
chrome.windows.onCreated.addListener(() => {
  cleanupNow();
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

// Manual cleanup trigger from the popup ("Clean up now" button)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.action === 'cleanupNow') {
    cleanupNow().then(() => sendResponse({ ok: true }));
    return true; // keep the message channel open for the async response
  }
});

// Merge duplicates and re-organize on demand. Works even while paused so the
// user can always collapse a pile of stale/dead groups back down to one each.
async function cleanupNow() {
  await cleanupDuplicateGroups();
  if (isPaused) {
    await reorderGroups();
  } else {
    await organizeTabs();
  }
}

// Re-entrancy guard: organizeTabs can be triggered concurrently by the alarm,
// tab activation, and storage changes. Without this, two overlapping runs can
// each decide a group doesn't exist yet and both create one, producing the
// duplicate Stale/Dead groups that accumulate over time. The guard serializes
// runs and coalesces any request that arrives mid-run into a single rerun.
let isOrganizing = false;
let rerunRequested = false;

async function organizeTabs() {
  // Skip organizing if extension is paused
  if (isPaused) return;

  if (isOrganizing) {
    rerunRequested = true;
    return;
  }

  isOrganizing = true;
  try {
    do {
      rerunRequested = false;
      await organizeTabsPass();
    } while (rerunRequested && !isPaused);
  } finally {
    isOrganizing = false;
  }
}

async function organizeTabsPass() {
  // Merge any duplicate groups before classifying, so a single keeper group
  // exists per title/window for tabs to be added to.
  await cleanupDuplicateGroups();

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
