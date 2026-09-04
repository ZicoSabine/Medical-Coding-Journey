# Daily Medical Coding Case Study Generator

This file is the durable operating specification for scheduled and manual case generation in this Obsidian vault. The clinical cases are fictional practice documentation. The learner performs all coding independently.

## Locations and preservation

- Treat the nearest ancestor containing `.obsidian` as the vault root.
- Store generated notes under the existing `Medical Coding/Case Study/` hierarchy, with `Simple/`, `Intermediate/`, and `Complex/` subfolders.
- Store generator state only under `Medical Coding/.case-generator/`.
- Read the matching template in `Templates/Case Study Templates/` before generation. Preserve compatible clinical field conventions, but omit its answer-entry section because generated case bodies may not contain coding answers or hints.
- Never delete or overwrite an existing case, learner answer, template, note, or unrelated file.
- Before writing, inspect `state.json`, `case_registry.json`, recent generated cases, and relevant legacy cases.

## Absolute no-answer rule

Never provide diagnosis, procedure, supply, or service codes; partial codes; ranges; families; modifiers; suggested answers; answer keys; lookup terms; index or tabular directions; proprietary descriptors; or statements pointing out which coding system applies to a sentence. Do not place such information in filenames, frontmatter, headings, comments, metadata, footnotes, companion files, confirmations, or chat responses.

Clinical terminology and realistic documentation are required. Do not visually emphasize details because they may matter to coding. Write laterality, anatomy, severity, technique, devices, quantities, route, setting, and encounter circumstances naturally without explaining their coding significance.

Use general clinical knowledge. Do not copy or reverse-engineer proprietary reference descriptions, commercial textbooks, or uploaded coding books. External research is normally unnecessary. If a clinical term truly needs verification, prefer authoritative public sources.

## Identification and metadata

- Assign the next unused sequential ID in the form `CASE-0001`, `CASE-0002`, and so on. Never reuse an ID.
- Save each case in its own file named only `CASE-####.md`.
- Use the next number in `case_registry.json`, while also checking the filesystem for collisions. If a target exists, advance to the next free number.
- New cases always have `status: pending`, an empty `date:`, an empty `time:`, an empty `Google Help:`, and a `generated_date` matching the generation date.
- `time` records the learner's time spent on the case. `Google Help` records the learner's Google-help count. The generator must leave both empty and must never overwrite learner-entered values.

Use this frontmatter unless a compatible template requirement adds a non-conflicting property:

```yaml
---
case_id: CASE-####
difficulty: simple | intermediate | complex
coding_area: "selected coding area"
specialty: "selected specialty or general"
status: pending
date:
generated_date: YYYY-MM-DD
time:
Google Help:
---
```

## Scheduled daily workflow

A scheduled run creates at most one daily request and never creates a case before the learner selects difficulty.

At the start of a scheduled run:

1. Read `state.json` and `case_registry.json`.
2. Check both the registry and filesystem for a daily case already generated for the scheduled local date.
3. If that daily case exists, do not generate another. Report only its case ID and location.
4. If the same date already has a pending daily request, do not create a duplicate request.
5. Otherwise write a pending request to `state.json` with request type `daily`, the scheduled date, status `awaiting_difficulty`, and requested count `1`.
6. Ask exactly: `What difficulty should today's case be?`
7. Present only: `1. Simple`, `2. Intermediate`, `3. Complex`, `4. Random`.
8. Stop and wait. Do not select a difficulty or generate a case.

When the learner replies with one of those choices or an obvious equivalent, continue the pending request. For Random, choose Simple, Intermediate, or Complex without weighting. Generate exactly one case, perform quality control, save it, update the registry, record the completed daily run, and clear the pending request. Confirm only the case ID, actual difficulty, and file location.

Never reuse yesterday's choice. Never create two daily cases because a scheduled run restarted.

## Manual requests

- Manual generation is separate from the daily workflow and is allowed even when a daily case exists.
- If the learner specifies a count, use it. If the learner asks for additional cases without a count, default to 100. An explicitly singular request means one case.
- If difficulty is specified, use it. If mixed difficulty is requested, distribute cases across all three levels. If difficulty is omitted, ask `What difficulty should I use?` with only Simple, Intermediate, Complex, and Random, then stop.
- If the immediately preceding interaction establishes difficulty unambiguously and the learner asks for another singular case, reuse that difficulty.
- Honor requested constraints such as specialty, setting, age range, gender, body system, disease family, procedure type, diagnosis focus, procedure focus, supply-heavy documentation, pediatrics, geriatrics, trauma, inpatient only, outpatient only, surgery only, or no surgery when medically reasonable and consistent with the no-answer rule.

## Coding areas and specialties

When not specified, use controlled variety among these areas: inpatient hospital, hospital outpatient, emergency department, physician or professional services, ambulatory surgery center, observation services, urgent care, primary care, specialty clinics, radiology, pathology and laboratory, anesthesia, behavioral health, rehabilitation therapy, home health, hospice and palliative care, skilled nursing facility, long-term care, durable medical equipment, ambulance services, dental or oral surgery, and telehealth.

For small batches, avoid immediate repeats when alternatives fit. For large batches, establish broad coverage first, shuffle the sequence, allow realistic repetition, and prevent any one area from dominating.

Mix general documentation with clinically appropriate specialty cases. Available specialties include cardiology, orthopedics, oncology, obstetrics and gynecology, pediatrics, general surgery, neurosurgery, gastroenterology, urology, pulmonology, nephrology, dermatology, ophthalmology, ear nose and throat, pain management, endocrinology, infectious disease, trauma, and transplant services. Do not force a specialty onto every case. A 100-case mixed batch should include every specialty at least once where clinically appropriate.

## Difficulty formats

### Simple

Use exactly these body labels:

**Patient:**  
[Fictional patient name or initials]

**Gender:**  
[Gender]

**Age:**  
[Age]

**Chief Complaint:**  
[Brief complaint]

**Medical History:**  
[Relevant history or "None reported."]

**Assessment and Diagnosis:**  
[Assessment and diagnosis]

Keep the principal scenario and assessment straightforward, each about one to three sentences. Usually include one primary diagnosis and at most one necessary secondary condition. Avoid distractors and procedure overload. Simple cases primarily develop diagnosis interpretation.

### Intermediate

Use exactly these body labels:

**Patient:**  
[Fictional patient name or initials]

**Gender:**  
[Gender]

**Age:**  
[Age]

**Case Report:**  
[Clinical narrative]

Write third-person clinical narrative or impersonal passive voice. Naturally include complaint, relevant history, symptoms, examination, useful diagnostic findings, assessment, confirmed diagnosis, and a service or procedure. Do not create coding-clue subsections. Inpatient cases may contain only minor inpatient procedures; outpatient cases may contain any clinically reasonable outpatient procedure. Include supplies or services only when natural.

### Complex

Use the same Patient, Gender, Age, and Case Report labels as Intermediate. Write a detailed continuous professional record in third person or impersonal passive voice. Include only clinically relevant elements from history, illness course, symptoms, examination, testing, diagnoses, procedures, anatomy, laterality, technique, treatment, medications, materials, supplies, devices, implants, equipment, complications, post-procedure status, disposition, and follow-up. Complexity must come from interacting diagnoses, services, materials, settings, or circumstances—not deficient documentation.

## Clinical and educational quality

- Make age, sex or gender, presentation, diagnosis, testing, procedure, materials, specialty, medications, sequence, setting, and disposition mutually plausible.
- Simple cases contain little or no irrelevant detail. Intermediate cases contain limited realistic secondary information. Complex cases may contain realistic distractors, but never medically false information added to trick the learner.
- Vary coding area, specialty, demographics, presentation, history, testing, procedures, treatment, materials, severity, and disposition while maintaining compatibility.
- Repeated diagnoses are eventually acceptable, but avoid substantially identical combinations of diagnosis, procedure, specialty, area, demographics, presentation, or technique.
- For large batches, create and validate one separate note at a time. Preserve completed files if interrupted and resume at the next unused ID.

## Required ending

Every case ends with exactly:

## Your Task

Using your current coding references, review the clinical documentation and determine the applicable coding based solely on the information provided.

Do not add hints, explanations, references, answer fields, or other material after that sentence.

## Save-time validation

Before every save, silently verify that no code, partial code, range, modifier, lookup hint, answer, proprietary descriptor, or artificial clue emphasis appears anywhere; the filename and metadata reveal no answer; the clinical record is plausible; diagnosis, procedure, materials, setting, specialty, and difficulty align; required fields exist; the case differs sufficiently from recent cases; the ID is unique; existing files remain protected; status is pending; date, time, and Google Help are empty; and exactly the requested number of notes will be created.

After each successful case, append non-answer duplicate-detection metadata to `case_registry.json`, advance `next_case_number`, and update `state.json` atomically enough that an interrupted run can resume without overwriting a file.
