-- =============================================
--   Day 6 - a school database in SQLite
--   Paste the whole file into sqliteonline.com and
--   press Run. Every statement is written to run as
--   one script, from empty, more than once.
-- =============================================

-- SQLite ignores foreign keys unless this is switched on.
-- It has to be set on every connection, so it is here at the top.
PRAGMA foreign_keys = ON;

-- Dropped in dependency order so the script can be re-run safely.
DROP TABLE IF EXISTS enrolments;
DROP TABLE IF EXISTS courses;
DROP TABLE IF EXISTS students;


-- ============ tables ============

-- One row per student.
CREATE TABLE students (
  student_id  INTEGER PRIMARY KEY,
  full_name   TEXT NOT NULL,
  -- UNIQUE makes the address an identifier: no two students share one,
  -- and the database refuses a duplicate instead of storing it.
  email       TEXT NOT NULL UNIQUE
);

-- One row per course.
CREATE TABLE courses (
  course_id    INTEGER PRIMARY KEY,
  course_code  TEXT NOT NULL UNIQUE,
  course_name  TEXT NOT NULL
);

-- The join table. One row per student-on-course pair, and it is the
-- only place the grade lives, because a grade belongs to the pairing
-- and to neither side on its own: Amina's CS101 grade is not a fact
-- about Amina, and not a fact about CS101.
CREATE TABLE enrolments (
  enrolment_id INTEGER PRIMARY KEY,
  student_id   INTEGER NOT NULL,
  course_id    INTEGER NOT NULL,
  -- Left nullable on purpose: a student can be signed up for a course
  -- before any marks exist, so "no grade yet" is a real state and must
  -- not be faked with an empty string.
  grade        TEXT,
  enrolled_on  TEXT NOT NULL,

  -- The two foreign keys are what make this table a join.
  FOREIGN KEY (student_id) REFERENCES students (student_id),
  FOREIGN KEY (course_id)  REFERENCES courses (course_id),

  -- The rule that stops the same student joining the same course twice.
  -- Taken together with the primary key this also leaves the database
  -- able to find a student's enrolments quickly.
  UNIQUE (student_id, course_id)
);

-- Queries 2 and 3 look enrolments up by course. UNIQUE above only
-- indexes (student_id, course_id), which cannot be used for a search
-- on course_id alone, so a course lookup means a full table scan.
-- This index is the fix. See school-design.md for the longer reason.
CREATE INDEX idx_enrolments_course ON enrolments (course_id);


-- ============ sample data ============

INSERT INTO students (student_id, full_name, email) VALUES
  (1, 'Amina Hassan',   'amina.hassan@example.com'),
  (2, 'Ben Carter',     'ben.carter@example.com'),
  (3, 'Chidi Okafor',   'chidi.okafor@example.com'),
  (4, 'Dana Whitfield', 'dana.whitfield@example.com');

INSERT INTO courses (course_id, course_code, course_name) VALUES
  (1, 'CS101',   'Introduction to Programming'),
  (2, 'CS102',   'Databases'),
  (3, 'MATH201', 'Linear Algebra'),
  (4, 'HIST110', 'Modern History');

-- Ben is signed up for MATH201 but has no grade yet, which is why the
-- grade column above is allowed to be empty.
-- Dana is in no course at all, and HIST110 has nobody on it: those two
-- gaps are what queries 3 and 4 exist to find.
INSERT INTO enrolments (enrolment_id, student_id, course_id, grade, enrolled_on) VALUES
  (1, 1, 1, 'A',  '2026-09-01'),
  (2, 1, 2, 'B+', '2026-09-01'),
  (3, 2, 1, 'B',  '2026-09-03'),
  (4, 2, 3, NULL, '2026-09-03'),
  (5, 3, 2, 'A-', '2026-09-08'),
  (6, 3, 3, 'C',  '2026-09-08');


-- ============ the five queries ============

-- 1. All courses for one student, found by name.
--    A JOIN across the three tables, because the student's name sits
--    in one table and the course details sit in another, joined by
--    enrolments. Without enrolments there is no path between them.
SELECT
  s.full_name,
  c.course_code,
  c.course_name,
  e.grade
FROM enrolments AS e
JOIN students AS s ON e.student_id = s.student_id
JOIN courses  AS c ON e.course_id  = c.course_id
WHERE s.full_name = 'Amina Hassan'
ORDER BY c.course_code;

-- 2. All students on one course.
--    The same join, walked the other way round: students first,
--    then the course they are on.
SELECT
  c.course_code,
  s.full_name,
  s.email,
  e.grade
FROM enrolments AS e
JOIN students AS s ON e.student_id = s.student_id
JOIN courses  AS c ON e.course_id  = c.course_id
WHERE c.course_code = 'CS101'
ORDER BY s.full_name;

-- 3. How many students are on each course.
--    GROUP BY collapses the joined rows into one row per course and
--    COUNT adds them up. LEFT JOIN rather than JOIN, so a course with
--    nobody on it still appears, as 0, instead of disappearing.
SELECT
  c.course_code,
  c.course_name,
  COUNT(e.enrolment_id) AS student_count
FROM courses AS c
LEFT JOIN enrolments AS e ON e.course_id = c.course_id
GROUP BY c.course_id, c.course_code, c.course_name
ORDER BY student_count DESC, c.course_code;

-- 4. Students who are not on any course.
--    A plain JOIN would throw these students away, because the rows
--    that prove "not on a course" are precisely the rows that are
--    missing. LEFT JOIN keeps every student and leaves the enrolment
--    columns empty; WHERE e.enrolment_id IS NULL then picks out only
--    the ones that matched nothing. IS NULL is used rather than
--    = NULL, which never matches anything.
SELECT
  s.student_id,
  s.full_name,
  s.email
FROM students AS s
LEFT JOIN enrolments AS e ON e.student_id = s.student_id
WHERE e.enrolment_id IS NULL
ORDER BY s.full_name;

-- 5. Record a grade for one enrolment.
--    Ben's MATH201 row is enrolment_id 4, the one that had no grade.
--    Rows are picked by enrolment_id, never by full_name, because two
--    students can share a name but an id is unique.
UPDATE enrolments
SET grade = 'A-'
WHERE enrolment_id = 4;

-- Read the row back to confirm the update landed.
SELECT
  enrolment_id,
  student_id,
  course_id,
  grade,
  enrolled_on
FROM enrolments
WHERE enrolment_id = 4;
