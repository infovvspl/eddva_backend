# Chapter lesson plan — evaluation rubric

Used with `eval-set.json` and `scripts/lesson-plan-eval.js`. The script records the
**automatic checks** (structure, period count, minutes, question answers, objective
links, cited pages, grounding). It cannot judge educational quality: a teacher of
the subject scores each plan 1–5 on the eight criteria below and notes the reason.

| # | Criterion | 1 (unusable) | 3 (needs edits) | 5 (ready to teach) |
|---|---|---|---|---|
| 1 | Curriculum and source alignment | Off-chapter or wrong board level | Mostly the chapter; some content from outside it | Follows the chapter and the book's sequence; pages correct |
| 2 | Factual correctness | Errors a student would learn | Minor slips | No errors found |
| 3 | Measurable objectives | Vague ("understand…") | Some observable, some not | Every objective observable, with a fitting Bloom level and check |
| 4 | Teaching-sequence coherence | Steps out of order or missing | Workable with reordering | Clear intro → development → practice → check, period to period |
| 5 | Feasible time allocation | Impossible in the period | Tight or padded in places | Realistic minutes for the class and activity |
| 6 | Assessment alignment | Questions don't test the objectives | Partly aligned; some answers weak | Each objective assessed; answers correct and complete |
| 7 | Differentiation and accessibility | Missing or token | Present but generic | Practical support / on-level / challenge paths; sensible adaptations, no stereotyping |
| 8 | Teacher usability | Would rewrite from scratch | Usable after editing | Usable as is; clear teacher and student actions |

**Also record:** grounded (yes/no) and whether the plan's warnings flagged real
problems (true positives) or noise; time to generate; whether the repair attempt
was needed. A plan for an ungrounded case must carry the "not verified against the
book" warning — if it does not, that is a defect regardless of scores.

**Pass bar (proposed):** average ≥ 3.5, no criterion 2 (factual) below 3, and every
ungrounded case flagged.
