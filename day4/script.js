/* ============================================
   QuickNotes - Day 4
   Character/word counters, draft saving and theme toggle.
   ============================================ */

const MAX_CHARS = 200;
const WARNING_THRESHOLD = 180;
const DRAFT_KEY = "quicknotes-draft";
const THEME_KEY = "quicknotes-theme";

/* Select all the elements we need */
const noteText = document.getElementById("note-text");
const charCount = document.getElementById("char-count");
const wordCount = document.getElementById("word-count");
const clearBtn = document.getElementById("clear-btn");
const themeToggle = document.getElementById("theme-toggle");

/* Count the words in a piece of text */
function countWords(text) {
  const trimmed = text.trim();
  if (trimmed === "") {
    return 0;
  }
  return trimmed.split(/\s+/).length;
}

/* Update both counters and the warning classes */
function updateCounts() {
  const text = noteText.value;
  const chars = text.length;
  const words = countWords(text);

  charCount.textContent = `${chars} / ${MAX_CHARS} characters`;
  wordCount.textContent = `${words} words`;

  // warning above 180 characters, over above 200
  charCount.classList.toggle("warning", chars > WARNING_THRESHOLD && chars <= MAX_CHARS);
  charCount.classList.toggle("over", chars > MAX_CHARS);
}

/* Save the current text as a draft */
function saveDraft() {
  localStorage.setItem(DRAFT_KEY, noteText.value);
}

/* Empty the textarea, reset the counters and drop the draft */
function clearNote() {
  noteText.value = "";
  localStorage.removeItem(DRAFT_KEY);
  updateCounts();
}

/* Apply a theme and remember it */
function setTheme(isDark) {
  document.body.classList.toggle("dark", isDark);
  themeToggle.textContent = isDark ? "Light mode" : "Dark mode";
  localStorage.setItem(THEME_KEY, isDark ? "dark" : "light");
}

/* Restore the saved theme, the saved draft, then update the counters */
function loadFromStorage() {
  setTheme(localStorage.getItem(THEME_KEY) === "dark");
  noteText.value = localStorage.getItem(DRAFT_KEY) || "";
  updateCounts();
}

/* Every keystroke updates the counters and saves the draft */
noteText.addEventListener("input", function () {
  updateCounts();
  saveDraft();
});

/* The Clear button empties everything */
clearBtn.addEventListener("click", clearNote);

/* The theme button switches between light and dark */
themeToggle.addEventListener("click", function () {
  setTheme(!document.body.classList.contains("dark"));
});

/* Escape inside the textarea clears it too */
noteText.addEventListener("keydown", function (event) {
  if (event.key === "Escape") {
    event.preventDefault();
    clearNote();
  }
});

/* On page load */
loadFromStorage();