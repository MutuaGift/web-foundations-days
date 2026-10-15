# School Database Design

The Day 6 database stores three things: the students, the courses, and the
fact that a student is enrolled on a course, along with the grade for it.
The third one is the interesting one, because it is not a thing on its own —
it only exists in relation to the other two.

All of the SQL is in [`school.sql`](school.sql).

## The tables

### `students`

One row per student.

- **`student_id`** — `INTEGER PRIMARY KEY`. The identifier, and the value other
  tables point at.
- **`full_name`** — `TEXT NOT NULL`. Every student has a name, so the column is
  not allowed to be empty.
- **`email`** — `TEXT NOT NULL UNIQUE`. This one is both `NOT NULL` and
  `UNIQUE`, because an email address is how a student is identified in
  practice. The `UNIQUE` constraint means the database itself refuses a second
  student with the same address, rather than trusting the code that writes the
  row to remember to check first.

### `courses`

One row per course.

- **`course_id`** — `INTEGER PRIMARY KEY`.
- **`course_code`** — `TEXT NOT NULL UNIQUE`, e.g. `CS101`. Short and fixed, so
  it is a better handle for people than the name is.
- **`course_name`** — `TEXT NOT NULL`, e.g. `Introduction to Programming`.

### `enrolments`

One row per student-on-course pair. This is the join table.

- **`enrolment_id`** — `INTEGER PRIMARY KEY`.
- **`student_id`** — `INTEGER NOT NULL`, a foreign key to `students`.
- **`course_id`** — `INTEGER NOT NULL`, a foreign key to `courses`.
- **`grade`** — `TEXT`, deliberately **nullable**. A student can be signed up for
  a course before any marks exist, so "not graded yet" is a real state. Making
  this `NOT NULL` would force a fake value like `'N/A'` into the column, and
  `''` would be worse, because it looks like a grade. `NULL` means what it says.
- **`enrolled_on`** — `TEXT NOT NULL`, the date the student signed up.

## Relationships

### `students` to `enrolments`: one-to-many

One student can have many enrolments, and each enrolment belongs to exactly one
student. One student taking three courses is three `enrolments` rows pointing
back at the same `student_id`. The student row is not repeated, it is just
referenced, so correcting a student's name fixes it in one place.

### `courses` to `enrolments`: one-to-many

The same shape in the other direction. One course holds many enrolments, and
each enrolment belongs to one course. CS101 having forty students is forty rows
that all carry `course_id = 1`.

### `students` to `courses`: many-to-many, which is why `enrolments` exists

Students and courses are many-to-many: one student takes many courses, and one
course has many students. Neither table can hold that fact on its own, because
a column on `students` can only point at a single course — a student with three
courses would need three columns, and which one held the third course would be
a guess. Putting a comma-separated list of course ids in one column does not
fix this either: nothing can check that each id is real, nothing stops a
duplicate, and searching it needs string matching instead of an index.

So the relationship gets a table of its own. `enrolments` is that table, and the
foreign keys on both sides are what turn it into a real many-to-many link. This
is a **join table**, also called an associative table, and the pattern is often
called many-to-many. It is the standard answer because it gets three things for
free:

- **It carries data of its own.** `grade` and `enrolled_on` belong to the
  pairing. Amina's CS101 grade is not a fact about Amina — she has different
  grades on different courses — and it is not a fact about CS101 either, since
  everyone on it did differently. The grade only exists in the space between
  the two, which is exactly where this table sits.
- **It can be constrained.** `UNIQUE (student_id, course_id)` is the rule that a
  student cannot join the same course twice. Neither of the other two tables
  has anywhere to write that rule, so without this table the database would
  happily store the same enrolment five times.
- **It can be indexed and joined from either end.** Finding a student's courses
  and finding a course's students are the same table read two ways, which is
  what queries 1 and 2 in `school.sql` do.

## An index worth adding

```sql
CREATE INDEX idx_enrolments_course ON enrolments (course_id);
```

Queries 2 and 3 both look up enrolments by course: query 2 lists the students
on one course, and query 3 counts them for every course. `enrolments` is also
the table that grows fastest, since it gains a row for every student who signs
up for every course they take.

The `UNIQUE (student_id, course_id)` constraint already creates an index, but
it is on the pair `(student_id, course_id)` in that order, so it can only be
used for searches that start with `student_id`. A lookup on `course_id` alone
cannot use it, which is why an index leading with `course_id` is worth having
alongside it.

This was checked rather than assumed. With the index, the query planner turns
query 3 into a direct search:

```
SEARCH e USING COVERING INDEX idx_enrolments_course (course_id=?) LEFT-JOIN
```

Without it, SQLite falls back to scanning `enrolments` and building a throwaway
index for the join:

```
BLOOM FILTER ON e (course_id=?)
SEARCH e USING AUTOMATIC COVERING INDEX (course_id=?) LEFT-JOIN
```

Worth being honest about the second one: on a table this small SQLite quietly
compiles the cost away, and the automatic index makes the query look fine. The
gap only opens up once `enrolments` holds thousands of rows, because an automatic
index is rebuilt from scratch on every execution and never persists, whereas the
real index is built once and reused.

## SQL or NoSQL

I would choose **SQL**, with SQLite as the engine, because the data here is
relational and full of rules the database ought to be enforcing for us: a
student cannot enrol on the same course twice, a grade has to hang off a real
student on a real course, and an email identifies exactly one student. Expressing
those as `UNIQUE` and `FOREIGN KEY` constraints means the rule holds no matter
which program writes to the database, and the database rejects bad data at the
moment it arrives rather than leaving invalid rows for someone to clean up
later. A document store would be a poor fit here, because a grade sitting inside
a student document would be duplicated onto every document for the courses that
student takes, and the "no duplicate enrolment" rule would become something the
application code has to remember on every single write. SQL is also simply the
easier answer for the questions being asked: `JOIN` and `GROUP BY` answer "which
courses is this student on" and "how many students per course" directly, which
is precisely the kind of question that spans several tables at once. A hybrid
store would only earn its extra complexity if the school later needed something
SQL handles badly, like logging a huge volume of clickstream events or storing
unstructured submission files, and nothing in this design needs that yet.

## A note on foreign keys in SQLite

Foreign keys are **off by default** in SQLite, so `school.sql` starts with:

```sql
PRAGMA foreign_keys = ON;
```

Without that line the `FOREIGN KEY` clauses are parsed but never checked, and
the database will happily accept an enrolment pointing at a student who does not
exist. The setting resets on every new connection, which is why it belongs at
the top of the script rather than being assumed.
