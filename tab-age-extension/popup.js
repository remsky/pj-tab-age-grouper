const warnInput = document.getElementById('warnInput');
const deadInput = document.getElementById('deadInput');
const warnValue = document.getElementById('warnValue');
const deadValue = document.getElementById('deadValue');
const zoneFresh = document.getElementById('zoneFresh');
const zoneStale = document.getElementById('zoneStale');
const zoneDead = document.getElementById('zoneDead');

// Exponential scale: 0.5 min to 2 weeks (20160 min)
const MIN = 0.5;
const MAX = 20160; // 2 weeks in minutes
const MIN_GAP_PERCENT = 2; // Minimum 2% gap on slider

// Convert slider position (0-100) to minutes (exponential)
function sliderToMinutes(sliderVal) {
  const percent = sliderVal / 100;
  return MIN * Math.pow(MAX / MIN, percent);
}

// Convert minutes to slider position (0-100)
function minutesToSlider(minutes) {
  minutes = Math.max(MIN, Math.min(MAX, minutes));
  return 100 * Math.log(minutes / MIN) / Math.log(MAX / MIN);
}

function formatValue(mins) {
  if (mins < 1) {
    return `${Math.round(mins * 60)}s`;
  } else if (mins < 60) {
    return mins % 1 === 0 ? `${mins}m` : `${mins.toFixed(1)}m`;
  } else if (mins < 1440) {
    const hours = mins / 60;
    return hours % 1 === 0 ? `${hours}h` : `${hours.toFixed(1)}h`;
  } else {
    const days = mins / 1440;
    return days % 1 === 0 ? `${days}d` : `${days.toFixed(1)}d`;
  }
}

function getPercent(sliderVal) {
  return sliderVal; // Slider is already 0-100
}

function updateSlider() {
  const warnSlider = parseFloat(warnInput.value);
  const deadSlider = parseFloat(deadInput.value);

  // Convert slider positions to actual minutes
  const warnMins = sliderToMinutes(warnSlider);
  const deadMins = sliderToMinutes(deadSlider);

  // Update displayed values
  warnValue.textContent = formatValue(warnMins);
  deadValue.textContent = formatValue(deadMins);

  // Calculate zone positions (slider is already 0-100)
  const warnPercent = warnSlider;
  const deadPercent = deadSlider;

  // Green zone: 0 to warn threshold
  zoneFresh.style.width = warnPercent + '%';

  // Yellow/stale zone: warn to dead threshold
  zoneStale.style.left = warnPercent + '%';
  zoneStale.style.width = (deadPercent - warnPercent) + '%';

  // Red/dead zone: dead threshold to end
  zoneDead.style.width = (100 - deadPercent) + '%';
}

// Prevent sliders from crossing
warnInput.addEventListener('input', () => {
  const warnVal = parseFloat(warnInput.value);
  const deadVal = parseFloat(deadInput.value);

  if (warnVal >= deadVal - MIN_GAP_PERCENT) {
    warnInput.value = deadVal - MIN_GAP_PERCENT;
  }
  updateSlider();
});

deadInput.addEventListener('input', () => {
  const warnVal = parseFloat(warnInput.value);
  const deadVal = parseFloat(deadInput.value);

  if (deadVal <= warnVal + MIN_GAP_PERCENT) {
    deadInput.value = warnVal + MIN_GAP_PERCENT;
  }
  updateSlider();
});

// Load saved settings
document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.sync.get(['warnMins', 'deadMins', 'extensionPaused', 'theme'], (items) => {
    // Convert stored minutes to slider positions
    const warnMins = items.warnMins || 5;
    const deadMins = items.deadMins || 30;
    warnInput.value = minutesToSlider(warnMins);
    deadInput.value = minutesToSlider(deadMins);
    updateSlider();

    // Restore pause state
    const pauseBtn = document.getElementById('pauseToggle');
    if (items.extensionPaused) {
      pauseBtn.classList.add('paused');
      pauseBtn.innerHTML = '&#9654;'; // Play icon when paused (click to resume)
    } else {
      pauseBtn.innerHTML = '&#9724;'; // Stop icon when running (click to pause)
    }

    // Restore theme state (0=water, 1=professional, 2=dark)
    const theme = items.theme || 0;
    applyTheme(theme);
  });
});

// Save settings
document.getElementById('saveBtn').addEventListener('click', () => {
  // Convert slider positions to minutes for storage
  const warnMins = sliderToMinutes(parseFloat(warnInput.value));
  const deadMins = sliderToMinutes(parseFloat(deadInput.value));

  chrome.storage.sync.set({
    warnMins: warnMins,
    deadMins: deadMins
  }, () => {
    const status = document.getElementById('status');
    status.style.opacity = '1';
    setTimeout(() => { status.style.opacity = '0'; }, 1500);
  });
});

// Manual input on value badge click
function showManualInput(valueEl, inputEl, isWarn) {
  const currentMins = sliderToMinutes(parseFloat(inputEl.value));
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'manual-input';
  input.value = formatValue(currentMins);
  input.placeholder = 'e.g. 5m, 2h, 1d';

  const originalText = valueEl.textContent;
  valueEl.textContent = '';
  valueEl.appendChild(input);
  input.focus();
  input.select();

  function parseInput(val) {
    val = val.trim().toLowerCase();
    const num = parseFloat(val);
    if (isNaN(num)) return null;

    if (val.endsWith('s')) return num / 60;
    if (val.endsWith('m')) return num;
    if (val.endsWith('h')) return num * 60;
    if (val.endsWith('d')) return num * 1440;
    if (val.endsWith('w')) return num * 10080;
    return num; // Default to minutes
  }

  function commit() {
    const mins = parseInput(input.value);
    if (mins !== null && mins >= MIN && mins <= MAX) {
      const sliderVal = minutesToSlider(mins);
      const otherVal = parseFloat(isWarn ? deadInput.value : warnInput.value);

      if (isWarn && sliderVal < otherVal - MIN_GAP_PERCENT) {
        inputEl.value = sliderVal;
      } else if (!isWarn && sliderVal > parseFloat(warnInput.value) + MIN_GAP_PERCENT) {
        inputEl.value = sliderVal;
      }
    }
    valueEl.textContent = formatValue(sliderToMinutes(parseFloat(inputEl.value)));
    updateSlider();
  }

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { commit(); input.blur(); }
    if (e.key === 'Escape') { valueEl.textContent = originalText; }
  });
}

warnValue.addEventListener('click', () => showManualInput(warnValue, warnInput, true));
deadValue.addEventListener('click', () => showManualInput(deadValue, deadInput, false));

// Pause toggle - pauses/resumes the grouping functionality
document.getElementById('pauseToggle').addEventListener('click', () => {
  const btn = document.getElementById('pauseToggle');
  const isPaused = btn.classList.toggle('paused');
  btn.innerHTML = isPaused ? '&#9654;' : '&#9724;'; // Play when paused (resume), stop when running (pause)
  chrome.storage.sync.set({ extensionPaused: isPaused });
});

// Theme handling (0=water, 1=professional, 2=dark)
let currentTheme = 0;
const themeIcons = ['&#128167;', '&#9634;', '&#9790;']; // 💧, □, ☾

function applyTheme(theme) {
  currentTheme = theme;
  const btn = document.getElementById('themeToggle');

  // Remove all theme classes
  document.body.classList.remove('professional', 'dark');
  btn.classList.remove('active', 'pro', 'dark');

  // Apply new theme
  if (theme === 0) {
    btn.classList.add('active'); // Water theme
  } else if (theme === 1) {
    document.body.classList.add('professional');
    btn.classList.add('pro');
  } else {
    document.body.classList.add('dark');
    btn.classList.add('dark');
  }

  btn.innerHTML = themeIcons[theme];
}

// Theme toggle - cycles through water → professional → dark
document.getElementById('themeToggle').addEventListener('click', () => {
  const nextTheme = (currentTheme + 1) % 3;
  applyTheme(nextTheme);
  chrome.storage.sync.set({ theme: nextTheme });
});
