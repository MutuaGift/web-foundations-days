/* ============================================
   Notes Toolkit - Day 3
   Open the browser Console (F12) to see the output.
   ============================================ */

/* Starting data -------------------------------- */
let notes = [
  { id: 1, text: "Buy milk and bread", category: "personal" },
  { id: 2, text: "Finish the Day 3 assignment", category: "study" },
  { id: 3, text: "Email the project report to Grace", category: "work" },
  { id: 4, text: "Revise JavaScript arrays", category: "study" },
  { id: 5, text: "Call mum", category: "personal" }
];

/* 1. searchNotes(word)
      Returns every note whose text contains the word,
      ignoring upper and lower case. */
function searchNotes(word) {
  const needle = word.toLowerCase();
  return notes.filter(function (note) {
    return note.text.toLowerCase().includes(needle);
  });
}

/* 2. longestNote()
      Returns the note object with the most characters,
      or null when there are no notes at all. */
function longestNote() {
  // handle the empty array first
  if (notes.length === 0) {
    return null;
  }

  let longest = notes[0];
  for (const note of notes) {
    if (note.text.length > longest.text.length) {
      longest = note;
    }
  }
  return longest;
}

/* 3. countByCategory()
      Counts how many notes sit in each category. */
function countByCategory() {
  const counts = { personal: 0, work: 0, study: 0 };

  for (const note of notes) {
    if (note.category in counts) {
      counts[note.category] += 1;
    }
  }
  return counts;
}

/* 4. getSummary()
      Builds a sentence such as
      "5 notes: 2 personal, 1 work, 2 study." */
function getSummary() {
  const counts = countByCategory();
  const total = notes.length;

  const parts = Object.keys(counts).map(function (category) {
    return `${counts[category]} ${category}`;
  });

  // "note" when there is exactly one, "notes" otherwise
  const word = total === 1 ? "note" : "notes";

  return `${total} ${word}: ${parts.join(", ")}.`;
}

/* 5. isDuplicate(text)
      True when a note with the same text already exists,
      ignoring case and extra spaces. */
function isDuplicate(text) {
  const target = text.trim().toLowerCase().replace(/\s+/g, " ");

  return notes.some(function (note) {
    const existing = note.text.trim().toLowerCase().replace(/\s+/g, " ");
    return existing === target;
  });
}

/* 6. addNote(text, category)
      Adds a note only when the text is 1-200 characters,
      is not a duplicate, and the category is valid.
      Returns true when added, false otherwise, and
      logs the reason. */
function addNote(text, category) {
  const allowed = ["personal", "work", "study"];

  if (typeof text !== "string") {
    console.log("addNote: rejected - text must be a string");
    return false;
  }

  if (text.length < 1 || text.length > 200) {
    console.log(
      `addNote: rejected - text must be 1-200 characters (got ${text.length})`
    );
    return false;
  }

  if (isDuplicate(text)) {
    console.log("addNote: rejected - that note already exists");
    return false;
  }

  if (!allowed.includes(category)) {
    console.log(
      `addNote: rejected - "${category}" is not a valid category (use personal, work or study)`
    );
    return false;
  }

  const nextId = notes.reduce(function (max, note) {
    return Math.max(max, note.id);
  }, 0) + 1;

  notes.push({ id: nextId, text: text.trim(), category: category });

  console.log(`addNote: added "${text.trim()}" under ${category}`);
  return true;
}

/* ============================================
   Tests
   Read-only tests run first, then the addNote
   tests at the end because addNote changes notes.
   ============================================ */

console.log("--- searchNotes ---");
// normal case: finds the one note that mentions milk
console.log(searchNotes("milk"));
// Expected: [ { id: 1, text: 'Buy milk and bread', category: 'personal' } ]  (1 note)

// edge case: uppercase needle still matches a lowercase word
console.log(searchNotes("JAVA"));
// Expected: [ { id: 4, text: 'Revise JavaScript arrays', category: 'study' } ]  (1 note)

// edge case: a word that is not in any note returns an empty array
console.log(searchNotes("zzz"));
// Expected: []  (0 notes)

console.log("--- longestNote ---");
// normal case: the report note is the longest of the five
console.log(longestNote());
// Expected: { id: 3, text: 'Email the project report to Grace', category: 'work' }  (33 characters)

// edge case: an empty array returns null
const savedNotes = notes;
notes = [];
console.log(longestNote());
// Expected: null
notes = savedNotes;

console.log("--- countByCategory ---");
// normal case: 2 personal, 1 work, 2 study
console.log(countByCategory());
// Expected: { personal: 2, work: 1, study: 2 }

// edge case: no notes means every counter stays at zero
notes = [];
console.log(countByCategory());
// Expected: { personal: 0, work: 0, study: 0 }
notes = savedNotes;

console.log("--- getSummary ---");
// normal case: five notes
console.log(getSummary());
// Expected: 5 notes: 2 personal, 1 work, 2 study.

// edge case: exactly one note uses the singular "note"
notes = [savedNotes[0]];
console.log(getSummary());
// Expected: 1 note: 1 personal, 0 work, 0 study.
notes = savedNotes;

console.log("--- isDuplicate ---");
// normal case: an exact match is a duplicate
console.log(isDuplicate("Buy milk and bread"));
// Expected: true

// normal case: text that is not stored is not a duplicate
console.log(isDuplicate("Plan the week"));
// Expected: false

// edge case: case and extra spaces are ignored
console.log(isDuplicate("  buy MILK   and BREAD "));
// Expected: true

console.log("--- addNote ---");
// normal case: a valid, new, personal note is added
console.log(addNote("Buy groceries", "personal"));
// Expected: addNote: added "Buy groceries" under personal
// Expected: true

// edge case: the same text again is rejected as a duplicate
console.log(addNote("Buy milk and bread", "study"));
// Expected: addNote: rejected - that note already exists
// Expected: false

// edge case: a duplicate is still caught when case and spaces differ
console.log(addNote("  buy   MILK and bread  ", "work"));
// Expected: addNote: rejected - that note already exists
// Expected: false

// edge case: text longer than 200 characters is rejected
console.log(addNote("x".repeat(201), "work"));
// Expected: addNote: rejected - text must be 1-200 characters (got 201)
// Expected: false

// edge case: empty text is rejected
console.log(addNote("", "work"));
// Expected: addNote: rejected - text must be 1-200 characters (got 0)
// Expected: false

// edge case: a category outside the allowed three is rejected
console.log(addNote("Book the flights", "shopping"));
// Expected: addNote: rejected - "shopping" is not a valid category (use personal, work or study)
// Expected: false

// edge case: text must be a string
console.log(addNote(null, "work"));
// Expected: addNote: rejected - text must be a string
// Expected: false

console.log("--- final notes array ---");
console.log(notes);
// Expected: 6 notes - the original five plus "Buy groceries"