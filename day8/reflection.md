# Course Reflection

**The hardest concept was realising that a check in application code is not a
guarantee.** In the ticketing design, the obvious way to stop two people buying
one seat is to read the seat's status, check it is `available`, then insert. That
code looks correct and is completely broken. Two requests arrive together, both
read `available`, both insert, and now two people hold tickets for one seat. The
gap between the reading and the writing is a race, and the only thing in the
system that sees both inserts at the same instant is the database. I overcame
this by moving the guarantee into a unique constraint, then testing it: running
two buyers against one seat in SQLite and watching the second be refused. Only
once I ran it did the idea move from "the theory says so" to something I
understood.

**What I would improve in my capstone.** QuickNotes' front end was tested with
hand-written browser harnesses rather than a real test framework, so every
regression check depended on me remembering to re-run them. The feedback I
received made me look harder at how little of it was automated. I would move to a
proper test setup wired into CI so the suite runs on every push. My architecture
document also concluded that one million users needs very little capacity — the
numbers did not justify anything larger — and I think I under-explained that
reasoning instead of defending it clearly.

**Next I want to learn** transactions under genuine concurrency: isolation
levels, deadlocks, and what happens when two transactions write the same row in
production. I would also like to build this ticketing backend for real, because
designing the constraint is not the same as watching it hold under load.
